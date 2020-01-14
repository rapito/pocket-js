import { ApplicationParams } from "../application-params"

/**
 *
 *
 * @class QueryAppParamsResponse
 */
export class QueryAppParamsResponse {
  /**
   *
   * Creates a QueryAppParamsResponse object using a JSON string
   * @param {String} json - JSON string.
   * @returns {QueryAppParamsResponse} - QueryAppParamsResponse object.
   * @memberof QueryAppParamsResponse
   */
  public static fromJSON(json: string): QueryAppParamsResponse {
    const jsonObject = JSON.parse(json)

    return new QueryAppParamsResponse(ApplicationParams.fromJSON(jsonObject))
  }

  public readonly applicationParams: ApplicationParams

  /**
   * QueryAppParamsResponse
   * @constructor
   * @param {ApplicationParams} applicationParams - Application params.
   */
  constructor(applicationParams: ApplicationParams) {
    this.applicationParams = applicationParams

    if (!this.isValid()) {
      throw new TypeError("Invalid properties length.")
    }
  }
  /**
   *
   * Creates a JSON object with the QueryAppParamsResponse properties
   * @returns {JSON} - JSON Object.
   * @memberof QueryAppParamsResponse
   */
  public toJSON() {
    return this.applicationParams.toJSON()
  }
  /**
   *
   * Check if the QueryAppParamsResponse object is valid
   * @returns {boolean} - True or false.
   * @memberof QueryAppParamsResponse
   */
  public isValid(): boolean {
    return this.applicationParams.isValid()
  }
}
