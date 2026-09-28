import { MailProvider } from "./types";

export class MailProviderRegistry {
  private readonly providers = new Map<string, MailProvider>();

  register(provider: MailProvider) {
    if (this.providers.has(provider.id)) throw new Error(`Mail provider duplicado: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  get(id: string) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Mail provider não registrado: ${id}`);
    return provider;
  }

  list() {
    return [...this.providers.values()].map(({ id, name }) => ({ id, name }));
  }
}
