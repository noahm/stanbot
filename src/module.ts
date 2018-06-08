import { Client } from "eris";

/**
 * All stanbot modules should implement this
 */
export interface Module {
  /**
   * Connect listeners for any events this module cares about
   */
  init(client: Client): void;
}
