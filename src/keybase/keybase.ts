import { Account } from "./models/account"
import * as ed25519 from "ed25519"
import { UnlockedAccount } from "./models/unlocked-account"
import * as pbkdf2 from "pbkdf2"
import { sha256 } from "js-sha256"
import * as aesjs from "aes-js"
import seedrandom from "seedrandom"
import { typeGuard } from "../utils/type-guard"
import {
    addressFromPublickey,
    publicKeyFromPrivate,
    validatePrivateKey,
    validateAddressHex
} from "../utils/key-pair"
import { IKVStore } from ".."

/**
 * @author Luis C. de León <luis@pokt.network>
 * @description The Keybase class allows storage, operations and persistence of accounts.
 */
export class Keybase {
    /**
     * Utility function to sign an arbitrary payload with a valid ed25519 private key
     * @param {Buffer} privateKey - The private key to sign with
     * @param {Buffer} payload - Arbitrary payload to sign
     * @returns {Buffer | Error} The signature or an Error
     * @memberof Keybase
     */
    public static signWith(
        privateKey: Buffer,
        payload: Buffer
    ): Buffer | Error {
        try {
            return ed25519.Sign(payload, privateKey)
        } catch (err) {
            return err
        }
    }

    private ACCOUNT_STORE_PREFIX = "account_"
    private ACCOUNT_INDEX_KEY = "account_index"
    private store: IKVStore
    private unlockedAccounts: Record<string, UnlockedAccount>

    /**
     * @description Constructor for the Keybase class
     * @param {IKVStore} store - The IKVStore to use to store encrypted accounts
     * @memberof Keybase
     */
    constructor(store: IKVStore) {
        this.store = store
        this.unlockedAccounts = {}
    }

    /**
     * @description Creates an account and stores it in the keybase
     * @param {string} passphrase The passphrase for the account in this keybase
     * @returns {Account | Error} The the new account or an Error
     * @memberof Keybase
     */
    public async createAccount(passphrase: string): Promise<Account | Error> {
        if (passphrase.length === 0) {
            return new Error("Empty passphrase")
        }

        try {
            // Create the keypair
            const rng = seedrandom(passphrase, { entropy: true })
            const seed = Buffer.from(sha256(rng().toString()), "hex")
            const keyPair = ed25519.MakeKeypair(seed)
            return await this.importAccount(keyPair.privateKey, passphrase)
        } catch (err) {
            return err
        }
    }

    /**
     * @description Lists all the accounts stored in this keybase
     * @returns {Account | Error} The the new account or an Error
     * @memberof Keybase
     */
    public async listAccounts(): Promise<Account[] | Error> {
        const result = new Array<Account>()
        let accountIndex = this.store.get(this.ACCOUNT_INDEX_KEY)
        if (typeGuard(accountIndex, Array)) {
            accountIndex = accountIndex as string[]
        } else if (accountIndex === undefined) {
            accountIndex = []
        } else {
            return new Error("Error fetching account index")
        }
        for (const index in accountIndex) {
            const accountOrError = await this.getAccount(accountIndex[index])
            if (typeGuard(accountOrError, Account)) {
                result.push(accountOrError as Account)
            } else {
                return accountOrError as Error
            }
        }
        return result
    }

    /**
     * @description Retrieves a single account from this keybase
     * @param {string} addressHex - The address of the account to retrieve in hex string format
     * @returns {Account | Error} - The the new account or an Error
     * @memberof Keybase
     */
    public async getAccount(addressHex: string): Promise<Account | Error> {
        return this.getAccountFromStore(addressHex)
    }

    /**
     * Generates a one time use UnlockedAccount from a persisted Account
     * @param {string} addressHex - The address hex for the account
     * @param {string} passphrase - The passphrase for the account
     * @returns {Promise<UnlockedAccount | Error>} The UnlockedAccount object or an Error
     * @memberof Keybase
     */
    public async getUnlockedAccount(addressHex: string, passphrase: string): Promise<UnlockedAccount | Error> {
        return this.unlockAccountFromPersistence(addressHex, passphrase)
    }

    /**
     * @description Deletes an account stored in the keybase
     * @param {string} addressHex - The address of the account to delete in hex string format
     * @param {string} passphrase - The passphrase for the account in this keybase
     * @returns {Promise<Error | undefined>} undefined if the account was deleted or an Error
     * @memberof Keybase
     */
    public async deleteAccount(
        addressHex: string,
        passphrase: string
    ): Promise<Error | undefined> {
        const validationError = validateAddressHex(addressHex)
        if (validationError) {
            return validationError
        }

        let error
        const unlockedAccountOrError = await this.unlockAccountFromPersistence(
            addressHex,
            passphrase
        )
        if (typeGuard(unlockedAccountOrError, UnlockedAccount)) {
            const unlockedAccount = unlockedAccountOrError as UnlockedAccount
            return this.removeAccountRecord(unlockedAccount)
        } else if (typeGuard(unlockedAccountOrError, Error)) {
            error = unlockedAccountOrError as Error
        } else {
            error = new Error("Unknown error decrypting Account")
        }
        return error
    }

    /**
     *
     * @param {string} addressHex The address of the account to update in hex string format
     * @param {string} passphrase The passphrase of the account
     * @param {string} newPassphrase The new passphrase that the account will be updated to
     * @returns {Promise<Error | undefined>} undefined if the account passphrase was updated or an Error
     * @memberof Keybase
     */
    public async updateAccountPassphrase(
        addressHex: string,
        passphrase: string,
        newPassphrase: string
    ): Promise<Error | undefined> {
        // Validate the address
        const validationError = validateAddressHex(addressHex)
        if (validationError) {
            return validationError
        }

        let error
        const unlockedAccountOrError = await this.unlockAccountFromPersistence(
            addressHex,
            passphrase
        )
        if (typeGuard(unlockedAccountOrError, UnlockedAccount)) {
            const unlockedAccount = unlockedAccountOrError as UnlockedAccount

            // Remove the account record with the existing passphrase
            const errorOrUndefined = await this.removeAccountRecord(
                unlockedAccount
            )
            if (typeGuard(errorOrUndefined, Error)) {
                error = errorOrUndefined as Error
            } else {
                const importedAccountOrError = this.importAccount(
                    unlockedAccount.privateKey,
                    newPassphrase
                )
                if (typeGuard(importedAccountOrError, Error)) {
                    error = importedAccountOrError as Error
                }
            }
        } else if (typeGuard(unlockedAccountOrError, Error)) {
            error = unlockedAccountOrError as Error
        } else {
            error = new Error("Unknown error decrypting Account")
        }
        return error
    }

    // Keybase ECDSA functions
    /**
     * @param {string} addressHex The address of the account that will sign the payload in hex string format
     * @param {string} passphrase The passphrase of the account
     * @param {Buffer} payload The payload to be signed
     * @returns {Promise<Buffer | Error>} Signature buffer or an Error
     * @memberof Keybase
     */
    public async sign(
        addressHex: string,
        passphrase: string,
        payload: Buffer
    ): Promise<Buffer | Error> {
        const unlockedAccountOrError = await this.unlockAccountFromPersistence(
            addressHex,
            passphrase
        )
        if (typeGuard(unlockedAccountOrError, Error)) {
            return unlockedAccountOrError as Error
        }
        const unlockedAccount = unlockedAccountOrError as UnlockedAccount
        try {
            return ed25519.Sign(payload, unlockedAccount.privateKey)
        } catch (err) {
            return err
        }
    }

    /**
     * @description Signs a payload with an unlocked account stored in this keybase
     * @param {string} addressHex The address of the account that will sign the payload in hex string format
     * @param {Buffer} payload The payload to be signed
     * @returns {Promise<Buffer | Error>} Signature buffer or an Error
     * @memberof Keybase
     */
    public async signWithUnlockedAccount(
        addressHex: string,
        payload: Buffer
    ): Promise<Buffer | Error> {
        // Validate the address
        const validationError = validateAddressHex(addressHex)
        if (validationError) {
            return validationError
        }

        const isUnlocked = await this.isUnlocked(addressHex)
        if (!isUnlocked) {
            return new Error("Account is not unlocked")
        }
        try {
            const unlockedAccount = this.unlockedAccounts[addressHex]
            return ed25519.Sign(payload, unlockedAccount.privateKey)
        } catch (err) {
            return err
        }
    }

    /**
     * @description Verify the signature for a given payload signed by `signedPublicKey`
     * @param {Buffer} signerPublicKey The public key of the signer
     * @param {Buffer} payload The payload to be verified against the signature
     * @param {Buffer} signature The calculated signature for the payload
     * @returns {Promise<Buffer | Error>} Signature buffer or an Error
     * @memberof Keybase
     */
    public async verifySignature(
        signerPublicKey: Buffer,
        payload: Buffer,
        signature: Buffer
    ): Promise<boolean> {
        try {
            return ed25519.Verify(payload, signature, signerPublicKey)
        } catch (err) {
            return false
        }
    }

    /**
     * @description Unlock an account for passphrase free signing of arbitrary payloads using `signWithUnlockedAccount`
     * @param {string} addressHex The address of the account that will be unlocked in hex string format
     * @param {string} passphrase The passphrase of the account to unlock
     * @param {number} unlockPeriod The amount of time (in ms) the account is going to be unlocked, defaults to 10 minutes. Use 0 to keep it unlocked indefinetely
     * @returns {Promise<Error | undefined>} Undefined if account got unlocked or an Error
     * @memberof Keybase
     */
    public async unlockAccount(
        addressHex: string,
        passphrase: string,
        unlockPeriod = 600000
    ): Promise<Error | undefined> {
        const unlockedAccountOrError = await this.unlockAccountFromPersistence(
            addressHex,
            passphrase
        )

        // Return errors if any
        if (typeGuard(unlockedAccountOrError, Error)) {
            return unlockedAccountOrError as Error
        }

        if (unlockPeriod > 0) {
            setTimeout(
                function (keybase, addressHex) {
                    keybase.lockAccount(addressHex)
                },
                unlockPeriod,
                this,
                addressHex
            )
        }

        // Cast to unlocked account
        const unlockedAccount = unlockedAccountOrError as UnlockedAccount
        this.unlockedAccounts[unlockedAccount.addressHex] = unlockedAccount
        return undefined
    }

    /**
     * @description Locks an unlocked account back so signing payloads with it will require a passphrase
     * @param {string} addressHex The address of the account that will be locked in hex string format
     * @returns {Promise<Error | undefined>} Undefined if account got locked or an Error
     * @memberof Keybase
     */
    public async lockAccount(addressHex: string): Promise<Error | undefined> {
        // Validate the address
        const validationError = validateAddressHex(addressHex)
        if (validationError) {
            return validationError
        }

        const isUnlocked = await this.isUnlocked(addressHex)
        if (!isUnlocked) {
            return new Error("Account is not unlocked")
        }
        delete this.unlockedAccounts[addressHex]
        return undefined
    }

    /**
     * @description Returns whether or not the specified account is unlocked
     * @param {string} addressHex The address of the account that will be verified in hex string format
     * @returns {Promise<boolean>} True or false if the account is unlocked
     * @memberof Keybase
     */
    public async isUnlocked(addressHex: string): Promise<boolean> {
        return this.unlockedAccounts[addressHex] ? true : false
    }

    // Import/export of accounts
    /**
     * @description Imports an account by using it's private key into this keybase
     * @param {Buffer} privateKey The private key of the account to be imported into this keybase
     * @param {string} passphrase The passphrase of the account to be imported into the keybase
     * @returns {Promise<Account | Error>} Imported account or an Error
     * @memberof Keybase
     */
    public async importAccount(
        privateKey: Buffer,
        passphrase: string
    ): Promise<Account | Error> {
        if (passphrase.length === 0) {
            return new Error("Empty passphrase")
        }

        if (!validatePrivateKey(privateKey)) {
            return new Error("Invalid private key")
        }
        try {
            // Parse public key
            const publicKey = publicKeyFromPrivate(privateKey)

            // Generate AES key
            const key = pbkdf2.pbkdf2Sync(
                passphrase,
                sha256(passphrase),
                1,
                256 / 8
            )

            // Generate encryptedBytes Hex
            const encryptedPKHex = aesjs.utils.hex.fromBytes(
                new aesjs.ModeOfOperation.ctr(key, undefined).encrypt(
                    privateKey
                )
            )
            const account = new Account(publicKey, encryptedPKHex)
            const errorOrUndefined = await this.persistAccount(account)
            if (typeGuard(errorOrUndefined, Error)) {
                return errorOrUndefined as Error
            } else {
                return account
            }
        } catch (err) {
            return err
        }
    }

    /**
     * @description Exports an account's private key stored in this keybase
     * @param {string} addressHex The address of the account that will be exported in hex string format
     * @param {string} passphrase The passphrase for the account that will be exported
     * @returns {Promise<Buffer | Error>} Exported account buffer or an Error
     * @memberof Keybase
     */
    public async exportAccount(
        addressHex: string,
        passphrase: string
    ): Promise<Buffer | Error> {
        const unlockedAccountOrError = await this.unlockAccountFromPersistence(
            addressHex,
            passphrase
        )
        if (typeGuard(unlockedAccountOrError, Error)) {
            return unlockedAccountOrError as Error
        }
        const unlockedAccount = unlockedAccountOrError as UnlockedAccount
        return unlockedAccount.privateKey
    }

    // Private interface
    /**
     * Returns an `UnlockedAccount` object corresponding to the `Account` object stored in this keybase
     * @param {string} addressHex The address of the account that will be used to create an `UnlockedAccount` in hex string format
     * @param {string} passphrase The passphrase for the account that will be used
     * @returns {Promise<UnlockedAccount | Error>} Unlocked account or an Error
     * @memberof Keybase
     */
    private async unlockAccountFromPersistence(
        addressHex: string,
        passphrase: string
    ): Promise<UnlockedAccount | Error> {
        // Validate the address
        const validationError = validateAddressHex(addressHex)
        if (validationError) {
            return validationError
        }

        let error
        const accountOrError = await this.getAccount(addressHex)
        if (typeGuard(accountOrError, Account)) {
            const account = accountOrError as Account
            try {
                // Generate decryption key
                const key = pbkdf2.pbkdf2Sync(
                    passphrase,
                    sha256(passphrase),
                    1,
                    256 / 8
                )

                // Generate encryptedBytes Hex
                const encryptedPKBytes = aesjs.utils.hex.toBytes(
                    account.encryptedPrivateKeyHex
                )

                // Decrypt the private key in hex format
                const decryptedPKHex = aesjs.utils.hex.fromBytes(
                    new aesjs.ModeOfOperation.ctr(key, undefined).decrypt(
                        encryptedPKBytes
                    )
                )

                // Extract the public key from the decrypted private key
                const decryptedPublicKey = decryptedPKHex.slice(
                    decryptedPKHex.length / 2,
                    decryptedPKHex.length
                )

                // Get the address from the public key
                const decryptedAddress = addressFromPublickey(
                    Buffer.from(decryptedPublicKey, "hex")
                )

                // Check addresses to make sure the decrypted account matches the intended account
                if (account.addressHex !== decryptedAddress.toString("hex")) {
                    return new Error("Wrong passphrase for account")
                }

                // Create the corresponding UnlockedAccount object
                const unlockedAccount = new UnlockedAccount(
                    account,
                    Buffer.from(decryptedPKHex, "hex")
                )
                return unlockedAccount
            } catch (err) {
                return err
            }
        } else if (typeGuard(accountOrError, Error)) {
            error = accountOrError as Error
        } else {
            error = new Error("Unknown error getting account")
        }
        return error
    }

    // Internal persistence interface
    /**
     * Persists an account in the storage of this keybase
     * @param {Account} account
     * @returns {Promise<Buffer | Error>} Signature buffer or an Error
     * @memberof Keybase
     */
    private async persistAccount(account: Account): Promise<Error | undefined> {
        // Create the store key
        const accountKey = this.generateAccountStoreKey(account)

        // Add the account to the store
        this.store.add(accountKey, account)

        // Add the new key into the index
        let accountIndex = this.store.get(this.ACCOUNT_INDEX_KEY)
        if (typeGuard(accountIndex, Array)) {
            accountIndex = accountIndex as string[]
        } else if (accountIndex === undefined) {
            accountIndex = []
        } else {
            return new Error("Error fetching the account index")
        }

        // Push the address hex into the index
        accountIndex.push(account.addressHex)

        // Persist the index to the store
        this.store.add(this.ACCOUNT_INDEX_KEY, accountIndex)

        // Return undefined for no errors
        return undefined
    }

    /**
     * Removes an account from the storage of this keybase
     * @param {Account} account
     * @returns {Promise<Error | undefined>} Undefined if the account was removed or an Error
     * @memberof Keybase
     */
    private async removeAccountRecord(
        account: Account
    ): Promise<Error | undefined> {
        // Create the store key
        const accountKey = this.generateAccountStoreKey(account)

        // Remove the account from the store
        this.store.remove(accountKey)

        // Remove the account key from the index
        let accountIndex = this.store.get(this.ACCOUNT_INDEX_KEY)
        if (typeGuard(accountIndex, Array)) {
            accountIndex = accountIndex as string[]
            const index = accountIndex.indexOf(account.addressHex, 0)
            if (index > -1) {
                accountIndex.splice(index, 1)
            }

            // Persist the index to the store
            this.store.add(this.ACCOUNT_INDEX_KEY, accountIndex)
        }

        // Return undefined for no errors
        return undefined
    }

    /**
     * Gets a properly parsed Account object from the store
     * @param {string} addressHex The address of the account in hex format
     * @returns {Promise<Account | Error>} Account from store or an Error
     * @memberof Keybase
     */
    private async getAccountFromStore(
        addressHex: string
    ): Promise<Account | Error> {
        let result: Account | Error

        // Validate the address
        const validationError = validateAddressHex(addressHex)
        if (validationError) {
            return validationError
        }

        // Attempt to fetch the account from the store
        const account = this.store.get(
            this.generateAccountStoreKeyFromAddressHex(addressHex)
        )

        // Verify the account fetched if any
        if (account === undefined) {
            result = new Error("Account not found")
        } else if (typeGuard(account, Account)) {
            result = account as Account
        } else {
            result = new Error("Error fetching account from store")
        }

        return result
    }

    /**
     * Generates a key to be used in the IKVStore for this keybase instance
     * @param {Account} account The account for which the key wants to be generated for
     * @returns {string} Account store key value
     * @memberof Keybase
     */
    private generateAccountStoreKey(account: Account): string {
        return this.ACCOUNT_STORE_PREFIX + account.addressHex
    }

    /**
     * Generates a key to be used in the IKVStore for this keybase instance from the address of
     * the account in hex format
     * @param {string} addressHex The account for which the key wants to be generated for
     * @returns {string} Generated Account store key.
     * @memberof Keybase
     */
    private generateAccountStoreKeyFromAddressHex(addressHex: string): string {
        return this.ACCOUNT_STORE_PREFIX + addressHex
    }
}
