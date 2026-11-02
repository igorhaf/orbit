import { Injectable } from "@nestjs/common";

export const ORBIT_EMBEDDING_MODEL = "text-embedding-3-small";
export const ORBIT_EMBEDDING_DIMENSIONS = 1536;

@Injectable()
export class OrbitEmbeddingsService {
  isAvailable() {
    return process.env.ORBIT_AI_EMBEDDINGS_ENABLED?.trim().toLowerCase() === "true"
      && Boolean(process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY?.trim());
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (!this.isAvailable()) throw new Error("Embeddings are not configured.");
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 64
      || inputs.some((input) => typeof input !== "string" || !input.trim() || input.length > 8_000))
      throw new Error("Invalid embedding input.");
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.ORBIT_OPENAI_EMBEDDINGS_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ model: ORBIT_EMBEDDING_MODEL, input: inputs, encoding_format: "float" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}.`);
    const payload = await response.json() as { data?: Array<{ index?: number; embedding?: unknown }> };
    if (!Array.isArray(payload.data) || payload.data.length !== inputs.length) throw new Error("Embedding response shape is invalid.");
    const ordered: number[][] = Array(inputs.length);
    for (const item of payload.data) {
      if (!Number.isInteger(item.index) || Number(item.index) < 0 || Number(item.index) >= inputs.length
        || !Array.isArray(item.embedding) || item.embedding.length !== ORBIT_EMBEDDING_DIMENSIONS
        || item.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value)))
        throw new Error("Embedding response contains an invalid vector.");
      ordered[Number(item.index)] = item.embedding as number[];
    }
    if (ordered.some((item) => !item)) throw new Error("Embedding response omitted a vector.");
    return ordered;
  }
}
