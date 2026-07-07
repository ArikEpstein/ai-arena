// src/tools.ts — tools with Zod validation on the args (the first guardrail).
// Model output is untrusted input: validate the schema before touching code/DB.
import { z } from "zod";

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const STORES: Record<string, { name: string; monthly_revenue: number; active_members: number }> = {
  "1001": { name: "Cafe Aroma TLV", monthly_revenue: 182000, active_members: 3120 },
  "1002": { name: "BurgerHub Haifa", monthly_revenue: 95000, active_members: 1440 },
  "1003": { name: "SushiBar BS", monthly_revenue: 61000, active_members: 870 },
};

const CUSTOMERS: Record<string, { name: string; store_id: string; points: number; tier: string }> = {
  "c-77": { name: "Dana", store_id: "1001", points: 240, tier: "gold" },
  "c-88": { name: "Omer", store_id: "1002", points: 55, tier: "silver" },
  "c-99": { name: "Yael", store_id: "1001", points: 12, tier: "bronze" },
};

export const TOOLS: Tool[] = [
  {
    name: "get_store_stats",
    description: "Returns store data: monthly revenue and number of active loyalty members.",
    input_schema: { type: "object", properties: { store_id: { type: "string" } }, required: ["store_id"] },
  },
  {
    name: "lookup_customer",
    description: "Returns customer details: name, store, points balance, and tier.",
    input_schema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] },
  },
  {
    name: "calculate_points",
    description: "Calculates loyalty points for a purchase amount (1 point per 10 shekels).",
    input_schema: { type: "object", properties: { amount_shekel: { type: "number" } }, required: ["amount_shekel"] },
  },
];

// Zod schemas = a validated input contract. If the model sends bad args — we fail gracefully, not crash.
// .strict() rejects unexpected keys — untrusted model output shouldn't smuggle in extra fields.
const SCHEMAS: Record<string, z.ZodTypeAny> = {
  get_store_stats: z.object({ store_id: z.string() }).strict(),
  lookup_customer: z.object({ customer_id: z.string() }).strict(),
  calculate_points: z.object({ amount_shekel: z.number().nonnegative() }).strict(),
};

export function runTool(name: string, rawInput: unknown): unknown {
  const schema = SCHEMAS[name];
  if (!schema) return { error: `unknown tool ${name}` };
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { error: `invalid args for ${name}`, issues: parsed.error.issues };
  switch (name) {
    case "get_store_stats": {
      const { store_id } = parsed.data as { store_id: string };
      const store = STORES[store_id];
      return store ? { store_id, ...store } : { error: "store not found" };
    }
    case "lookup_customer": {
      const { customer_id } = parsed.data as { customer_id: string };
      const id = customer_id.toLowerCase(); // a live model may forward "C-77" as typed
      const customer = CUSTOMERS[id];
      return customer ? { customer_id: id, ...customer } : { error: "customer not found" };
    }
    case "calculate_points": {
      const { amount_shekel } = parsed.data as { amount_shekel: number };
      return { amount_shekel, points: Math.round(amount_shekel * 0.1) };
    }
    default:
      return { error: "unhandled" };
  }
}
