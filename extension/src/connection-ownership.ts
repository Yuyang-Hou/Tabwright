export class ConnectionOwnership<Connection> {
  private currentGeneration = 0
  current: Connection | null = null

  beginAttempt(): number {
    this.currentGeneration += 1
    return this.currentGeneration
  }

  invalidateAttempt(generation: number): boolean {
    if (generation !== this.currentGeneration) {
      return false
    }
    this.currentGeneration += 1
    return true
  }

  isCurrentAttempt(generation: number): boolean {
    return generation === this.currentGeneration
  }

  claimOpenedConnection(options: { generation: number; connection: Connection }): boolean {
    if (!this.isCurrentAttempt(options.generation)) {
      return false
    }
    this.current = options.connection
    return true
  }

  isCurrentConnection(connection: Connection): boolean {
    return this.current === connection
  }

  releaseConnection(connection: Connection): boolean {
    if (!this.isCurrentConnection(connection)) {
      return false
    }
    this.current = null
    return true
  }
}
