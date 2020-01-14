import { Node } from "./node"
import { Configuration } from "../configuration/configuration"
import { RpcErrorResponse } from "./output/rpc-error-response"

/**
 *
 *
 * @class Routing
 */
export class Routing {
  public readonly nodes: Node[] = []
  public readonly configuration: Configuration
  public readonly localNodesFileName = ""
  private fs = require("fs")
  /**
   * Creates an instance of routing.
   * @param {Array} nodes - Array holding the initial node(s).
   * @param {Configuration} configuration - Configuration object.
   * @memberof Routing
   */
  constructor(nodes: Node[], configuration: Configuration) {
    if (nodes.length > configuration.maxNodes) {
      throw new Error(
        "Routing table cannot contain more than the specified maxNodes per blockchain."
      )
    }
    if (nodes.length < 1) {
      this.loadLocalNodes()
      throw new Error(
        "Routing table must be initialized with at least one node."
      )
    }

    this.nodes = nodes
    this.configuration = configuration
  }

  /**
   * Reads an array of random nodes from the routing table
   * @param {number} count - desired number of nodes returned
   * @memberof Routing
   */
  public readRandomNodes(count: number): Node[] {
    const nodes = this.nodes
    // Shuffle array then return the slice
    const shuffled = nodes.sort(() => 0.5 - Math.random())
    return shuffled.slice(0, count)
  }

  /**
   * Reads a random node from the routing table based on blockchain netID
   * @memberof Routing
   */
  public readRandomNode(): Node {
    return this.nodes[Math.floor(Math.random() * this.nodes.length)]
  }

  /**
   * Gets a node for the Pocket network rpc calls
   * @memberof Routing
   */
  public getNode(): Node | RpcErrorResponse {
    if (this.nodes.length < 0) {
      this.loadLocalNodes()
      if (this.nodes.length > 0) {
        return this.nodes[Math.floor(Math.random() * this.nodes.length)]
      }
    }
    return new RpcErrorResponse("101", "Node not found in routing table.")
  }

  /**
   * Reads a specific node from the routing table based on public key
   * @param {string} publicKey - public key attached to the node
   * @memberof Routing
   */
  public readNode(publicKey: string): Node {
    this.nodes.forEach(function(node: Node) {
      if (node.address === publicKey) {
        return node
      }
    })
    throw new Error("Node not found in routing table.")
  }

  /**
   * Add a node to the routing table
   * @param {Node} node - node object to be added
   * @memberof Routing
   */
  public addNode(node: Node) {
    this.nodes.push(node)
    // If this pushes the count over the maxNodes, splice the first element off
    if (this.nodes.length > this.configuration.maxNodes) {
      this.nodes.splice(0, 1)
    }
  }

  /**
   * Deletes a node from the routing table
   * @param {Node} node - node object to be deleted
   * @memberof Routing
   */
  public deleteNode(node: Node): boolean {
    // Cycle through the list of nodes, find a match, splice it off
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].address === node.address) {
        this.nodes.splice(i, 1)
        return true
      }
    }
    return false
  }

  /**
   * Configuration stores settings.
   * @constructor
   * @param {Node[]} nodes - (optional) Node list.
   * @memberof Routing
   */
  public loadLocalNodes() {
    const nodeList = JSON.parse(
      this.fs.readFileSync(this.localNodesFileName, "utf8").tostring()
    )

    for (let index = 0; index < nodeList.serviceNodes.length; index++) {
      const node = Node.fromJSON(JSON.stringify(nodeList.serviceNodes[index]))
      this.addNode(node)
    }
  }

  /**
   * Filter a list of nodes by chain.
   * @param {string} blockchain - Blockchain hash.
   * @param {Node[]} nodes - Node list to filter.
   * @returns {Node[]} - Filtered list of nodes.
   * @memberof Routing
   */
  public filterNodes(blockchain: string, nodes: Node[]): Node[] {
    const nodeList: Node[] = []
    if (this.nodes.length < 1) {
      // Load local nodes if none are loaded
      this.loadLocalNodes()
    }
    nodes.forEach(node => {
      node.chains.forEach(chain => {
        if (chain === blockchain) {
          nodeList.push(node)
        }
      })
    })
    return nodes
  }

  /**
   * Filter the nodes list by chain and return a random one
   * @param {string} blockchain - Blockchain hash.
   * @param {Node[]} nodes - Node list to filter.
   * @returns {Node[]} - Filtered list of nodes.
   * @memberof Routing
   */
  // TODO: Do round robin type selection
  public readNodeBy(blockchain: string): Node | RpcErrorResponse {
    const filteredNodes = this.filterNodes(blockchain, this.nodes)
    if (filteredNodes.length !== 0) {
      return filteredNodes[Math.floor(Math.random() * this.nodes.length)]
    } else {
      return new RpcErrorResponse(
        "",
        "Failed to read node for the provided blockchain"
      )
    }
  }
  /**
   * Filter a provided list of nodes by chain and return a random one
   * @param {string} blockchain - Blockchain hash.
   * @param {Node[]} nodes - Node list to filter.
   * @returns {Node[]} - Filtered list of nodes.
   * @memberof Routing
   */
  // TODO: Do round robin type selection
  public readNodeFrom(
    blockchain: string,
    nodes: Node[]
  ): Node | RpcErrorResponse {
    const filteredNodes = this.filterNodes(blockchain, nodes)
    if (filteredNodes.length !== 0) {
      return filteredNodes[Math.floor(Math.random() * this.nodes.length)]
    } else {
      return new RpcErrorResponse(
        "",
        "Failed to read node for the provided blockchain"
      )
    }
  }
}
