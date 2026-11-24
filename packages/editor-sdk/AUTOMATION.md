# Module automation

A trusted feature module contributes its editor operations through the public SDK. The desktop MCP server and the
built-in assistant use the same registry, validators and executor; a new feature does not need a host domain import.

```ts
import {automationTool, automationTools, automationSchema as z} from '@rewrite/sdk';

context.contribute(automationTools, 'feature.rename', automationTool(
  z.object({id:z.string().min(1), name:z.string().min(1)}).strict(),
  {
    description:'Rename an item using the feature service.',
    effect:'edit',
    output:z.object({id:z.string()}),
    execute:args => {
      service.rename(args.id,args.name);
      return {id:args.id};
    },
  },
));
```

- IDs must be namespaced by the contributing module. ModuleHost rolls back failed registrations and removes them on
  shutdown. These are trusted modules, not a sandbox or arbitrary third-party code-loading API.
- `read` must not mutate; `edit` is a synchronous, validated document transaction. Never start asynchronous work in an
  edit callback. Explicit edit batches commit once and roll back entirely on failure. Input/output validation runs
  before the transaction commits. Feature services still own reference and semantic validation.
- `session` is presentation/lifecycle work (selection, camera, Preview, source editing); it cannot enter an edit batch.
  `job` is asynchronous work with an AbortSignal and captured generation/revision. Check them immediately before
  document adoption; cancellation cannot roll back a promise's external side effects.
- Critical operations declare `approval:true`. The editor binds approval to input and document context; the AI cannot
  approve itself. Running atomic file commits declare `cancellable:false`. Only project-replacement jobs declare
  `changesProject:true`.
- Payload schemas for complex components and registered project sections can be published through optional
  `dataSchema`. Introspection does not replace the owning parser. Nonconstructible components may have no defaults.
- Returned values must be serializable data; never return functions, renderer nodes, Pixi/Howler objects or credentials.
  Optional `output` validates and advertises the result schema. Document formats are unchanged.
- Use the normal command/service path. Do not add arbitrary shell, renderer evaluation, unrestricted filesystem or
  generic command-dispatch escape hatches. Runtime exports contain runtime contributions, not automation UI.

Desktop use: enable **Settings → Editor → MCP server**, copy HTTP/stdio setup, and grant asset/output folders there.
Agent entry points are `automation.capabilities`, `automation.describe_tool`, `project.get_state` and
`project.file_access`. `automation.execute` adds generation/revision/scene guards; `automation.execute_batch` groups
synchronous document edits. Long calls return job IDs (`automation.job`, `automation.jobs`, `automation.cancel`);
`automation.job` accepts `waitMs` up to 10000 for bounded waiting. Capabilities support query/offset/limit.
`screenshot` and `editor.view` support visual verification. A revealed credential blocks screenshots until hidden.
Extra folder grants are session-local; user approval is required for project replacement, explicit-path save and export.
The running editor is required. Loopback HTTP and the stdio bridge are supported; remote/headless execution is not.

Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:mcp`, `pnpm test:automation`. The last suite authors
through MCP, grants/approves only through UI, then runs its two-scene HTML export in a separate Chrome process. It
includes real image/audio import, prefab/library work, timeline, physics and silent Step/live audio checks.
`test:automation:specialists` checks Profiler, QuickJS debugger, Sound Lab and Git; `test:localhub` covers Files MCP.
`test:automation:real` is opt-in actual tool/vision-model acceptance (same agent/catalog, native MCP, independent
Chrome export); source and packaged macOS runs passed with local Gemma. Ordinary automated suites need no live model.
`scripts/acceptance.mjs` includes native MCP suites and supports packaged executables. The built-in assistant keeps
its directly advertised catalog below 64 functions; discovery/execute still reaches the full installed registry.
No mobile signing/device execution, arbitrary UI clicking or remote/headless operation is claimed.

### Long-running observation and runtime jobs

A tool with `effect: 'job'` returns a handle; callers poll `automation.job` and may use `automation.cancel` when
`cancellable` is enabled. `allowDuringPreview: true` permits a runtime job in Preview. A trusted contribution may
set `readOnly: true` for an observation job (for example readiness), so it can wait while file/asset work is busy;
it must not mutate documents or runtime state. A read-only job may return `{state: 'cancelled'}` when its captured
project generation changes. These declarations are scheduling metadata, not a security sandbox.

Jobs may call `context.report?.({completed,total,message})`; the bounded progress is retained on the job and shown
in AI activity. Always listen to `context.signal` and release captured resources on cancellation. Runtime jobs must
capture session identity and never clean up a replacement session. Long loops should yield to the event loop so
cancellation and native UI remain responsive.
