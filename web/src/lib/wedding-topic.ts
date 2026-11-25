export const WEDDING_TOPIC_PREFIX = "wedding-v1-";
const TOPIC_PATTERN = new RegExp(`^${WEDDING_TOPIC_PREFIX}[A-Za-z0-9_-]{43}$`);

export function isWeddingTopic(topic: string | null | undefined): topic is string {
  return typeof topic === "string" && TOPIC_PATTERN.test(topic);
}
