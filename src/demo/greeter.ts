export class Greeter {
  greet(name: string): string {
    return `Hello ${name}`
  }
}

export function makeGreeting(name: string): string {
  return new Greeter().greet(name)
}
