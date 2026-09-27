import { Injectable } from "@nestjs/common";
import { CalendarSourceProvider } from "./types";

@Injectable()
export class CalendarSourceRegistry {
  private providers = new Map<string, CalendarSourceProvider>();
  register(provider: CalendarSourceProvider) {
    if (this.providers.has(provider.id))
      throw new Error(`Calendar provider duplicado: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }
  get<T extends CalendarSourceProvider>(id: string) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Calendar provider não registrado: ${id}`);
    return provider as T;
  }
  catalog() {
    return [...this.providers.values()].map(({ id, name }) => ({ id, name }));
  }
  all() {
    return [...this.providers.values()];
  }
}
