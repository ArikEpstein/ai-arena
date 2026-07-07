// src/tools.ts — tools with Zod validation on the args.
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

// One registry entry per tool: the wire schema sent to the model, the Zod contract that
// validates the model's arguments (.strict() rejects unexpected keys), and the handler,
// typed from the Zod schema so the three can't drift apart.
interface ToolDef<S extends z.ZodTypeAny> {
  description: string;
  input_schema: Record<string, unknown>;
  schema: S;
  run: (args: z.infer<S>) => unknown;
}

function defineTool<S extends z.ZodTypeAny>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const REGISTRY = {
  get_store_stats: defineTool({
    description: "Returns store data: monthly revenue and number of active loyalty members.",
    input_schema: { type: "object", properties: { store_id: { type: "string" } }, required: ["store_id"] },
    schema: z.object({ store_id: z.string() }).strict(),
    run: ({ store_id }) => {
      const store = STORES[store_id];
      return store ? { store_id, ...store } : { error: "store not found" };
    },
  }),
  lookup_customer: defineTool({
    description: "Returns customer details: name, store, points balance, and tier.",
    input_schema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] },
    schema: z.object({ customer_id: z.string() }).strict(),
    run: ({ customer_id }) => {
      const id = customer_id.toLowerCase(); // a live model may forward "C-77" as typed
      const customer = CUSTOMERS[id];
      return customer ? { customer_id: id, ...customer } : { error: "customer not found" };
    },
  }),
  calculate_points: defineTool({
    description: "Calculates loyalty points for a purchase amount (1 point per 10 shekels).",
    input_schema: { type: "object", properties: { amount_shekel: { type: "number" } }, required: ["amount_shekel"] },
    schema: z.object({ amount_shekel: z.number().nonnegative() }).strict(),
    run: ({ amount_shekel }) => ({ amount_shekel, points: Math.round(amount_shekel * 0.1) }),
  }),
} satisfies Record<string, ToolDef<z.ZodTypeAny>>;

export const TOOLS: Tool[] = Object.entries(REGISTRY).map(([name, def]) => ({
  name,
  description: def.description,
  input_schema: def.input_schema,
}));

export function runTool(name: string, rawInput: unknown): unknown {
  // Widen to the generic ToolDef so run() accepts its own schema's output (the per-tool
  // pairing is already guaranteed by defineTool's inference at the definition site).
  const def: ToolDef<z.ZodTypeAny> | undefined = REGISTRY[name as keyof typeof REGISTRY];
  if (!def) return { error: `unknown tool ${name}` };
  const parsed = def.schema.safeParse(rawInput);
  if (!parsed.success) return { error: `invalid args for ${name}`, issues: parsed.error.issues };
  return def.run(parsed.data);
}
