/** Default-exported service object; methods rely on `this`. */
export default {
  base: 'https://real.example',
  endpoint(this: { base: string }, path: string): string {
    return `${this.base}${path}`
  },
  get(this: { endpoint(path: string): string }, path: string): string {
    return `GET ${this.endpoint(path)}`
  },
}
