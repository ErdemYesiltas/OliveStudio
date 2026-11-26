import {z} from 'zod';
import {ActionSchema, ConditionSchema} from './schemas';

/**
 * Logic graph (visual scripting without code): Event nodes start a flow when their trigger fires; Action nodes run an
 * action and continue; Branch nodes check a global condition (true / false outputs); Delay nodes wait game seconds.
 * Director nodes coordinate branches and wait for events.
 * One output may feed several nodes, which run in link order. Flows run on the object that owns the graph.
 */
export const graphType = 'interactions.graph';
const Base = {id: z.string().min(1).max(100), x: z.number().finite().min(-1e5).max(1e5), y: z.number().finite().min(-1e5).max(1e5)};
const Trigger = z.object({type: z.string().min(1), sourceId: z.string(), event: z.string()}).strict();
const Seconds = z.number().min(0).max(3600);
export const GraphNodeSchema = z.discriminatedUnion('kind', [
 z.object({...Base, kind: z.literal('event'), trigger: Trigger}).strict(),
 z.object({...Base, kind: z.literal('action'), action: ActionSchema}).strict(),
 z.object({...Base, kind: z.literal('branch'), condition: ConditionSchema}).strict(),
 z.object({...Base, kind: z.literal('delay'), seconds: Seconds}).strict(),
 z.object({...Base, kind: z.literal('parallel')}).strict(),
 z.object({...Base, kind: z.literal('race')}).strict(),
 z.object({...Base, kind: z.literal('waitFor'), trigger: Trigger}).strict(),
 z.object({...Base, kind: z.literal('timeout'), seconds: Seconds}).strict(),
]);
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export const graphPorts: Record<GraphNode['kind'], readonly string[]> = {event: ['next'], action: ['next'], branch: ['true', 'false'], delay: ['next'], parallel: ['run', 'next'], race: ['run', 'next'], waitFor: ['next'], timeout: ['run', 'next', 'expired']};
export const hasGraphTrigger = (node: GraphNode): node is Extract<GraphNode, {kind: 'event' | 'waitFor'}> =>
 node.kind === 'event' || node.kind === 'waitFor';
export const GraphLinkSchema = z.object({id: z.string().min(1).max(100), from: z.string().min(1), port: z.string().min(1), to: z.string().min(1)}).strict();
export const GraphSchema = z.object({nodes: z.array(GraphNodeSchema).max(256), links: z.array(GraphLinkSchema).max(512)}).strict().superRefine((g, c) => {
 const nodes = new Map(g.nodes.map(n => [n.id, n]));
 if (nodes.size !== g.nodes.length) c.addIssue({code: 'custom', message: 'Graph node IDs must be unique'});
 if (new Set(g.links.map(l => l.id)).size !== g.links.length) c.addIssue({code: 'custom', message: 'Graph link IDs must be unique'});
 for (const l of g.links) {
  const from = nodes.get(l.from), to = nodes.get(l.to);
  if (!from || !to) c.addIssue({code: 'custom', message: 'A graph link points to a missing node'});
  else if (!graphPorts[from.kind].includes(l.port)) c.addIssue({code: 'custom', message: `A ${from.kind} node has no "${l.port}" output`});
  else if (to.kind === 'event') c.addIssue({code: 'custom', message: 'Event nodes have no input'});
 }
});
export type Graph = z.infer<typeof GraphSchema>;
export const emptyGraph = (): Graph => ({nodes: [], links: []});
/** Nodes a port leads to, in link order. */
export const nextNodes = (graph: Graph, from: string, port: string) => graph.links.filter(l => l.from === from && l.port === port).map(l => l.to);
