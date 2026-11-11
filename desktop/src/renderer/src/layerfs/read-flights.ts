/** Share concurrent background reads; retain a fresh queued read after mutations. */
export class ReadFlights {
  private epoch = 0
  private flights = new Map<string, { promise: Promise<unknown>; started: boolean; epoch: number }>()
  invalidate(): void { this.epoch++ }
  read<T>(path: string, run: () => Promise<T>, fresh = false): Promise<T> {
    const previous = this.flights.get(path)
    if (previous && (!previous.started || !fresh && previous.epoch === this.epoch)) return previous.promise as Promise<T>
    const flight = { promise: Promise.resolve<unknown>(undefined), started: false, epoch: this.epoch }
    const begin = () => { flight.started = true; flight.epoch = this.epoch; return run() }
    flight.promise = (previous ? previous.promise.catch(() => undefined).then(begin) : begin()).finally(() => {
      if (this.flights.get(path) === flight) this.flights.delete(path)
    })
    this.flights.set(path, flight)
    return flight.promise as Promise<T>
  }
}
