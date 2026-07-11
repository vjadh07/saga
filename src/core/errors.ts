export class SagaExecutionError extends Error {
  constructor(
    message: string,
    readonly actionId: string,
  ) {
    super(message);
    this.name = "SagaExecutionError";
  }
}

export class CompensationError extends Error {
  constructor(
    message: string,
    readonly actionId: string,
  ) {
    super(message);
    this.name = "CompensationError";
  }
}
