// Tipos mínimos del entorno de Cloudflare (evita depender de @cloudflare/workers-types).
declare module 'cloudflare:workers' {
  export class DurableObject<E = unknown> {
    constructor(ctx: DurableObjectState, env: E)
    protected ctx: DurableObjectState
    protected env: E
  }
  export interface DurableObjectState {
    storage: { sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] } }; transactionSync<T>(fn: () => T): T }
  }
}
