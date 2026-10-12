export class DurableObject<E> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: E,
  ) {}
}
