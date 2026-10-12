import { CodeBlock } from "@/components/copy-button.tsx";
import { Panel } from "@/components/ui.tsx";

const PATH = "/api/v1/integrations";

function Tool({
  id,
  name,
  endpoint,
  auth,
  children,
}: {
  id: string;
  name: string;
  endpoint: string;
  auth: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`import-${id}`} className="min-w-0 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 id={`import-${id}`} className="text-sm font-semibold">
        {name}
      </h3>
      <dl className="mt-2 mb-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-ink-2">Endpoint</dt>
        <dd className="font-mono text-[13px] break-all">{endpoint}</dd>
        <dt className="text-ink-2">Auth</dt>
        <dd className="text-[13px]">{auth}</dd>
      </dl>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">{children}</div>
    </section>
  );
}

/** Settings section: setup snippets for importing usage from LiteLLM, Helicone and OpenRouter. */
export function IntegrationsSection({ app, exampleClient }: { app: string; exampleClient: string }) {
  const litellmConfig = `litellm_settings:
  callbacks: ["llmpense"]

callback_settings:
  llmpense:
    callback_type: generic_api
    endpoint: ${app}${PATH}/litellm
    headers:
      Authorization: Bearer lpk_...
    event_types:
      - llm_api_success`;
  const litellmRequest = `client.chat.completions.create(
    model="claude-sonnet",
    messages=[{"role": "user", "content": "Hello"}],
    extra_body={
        "metadata": {
            "llmpense_client": "${exampleClient}",
            "llmpense_project": "support-bot",
            "llmpense_feature": "chat",
            "llmpense_run": "ticket-4711",  # optional, for cost per result
            # or: "tags": ["client:${exampleClient}", "project:support-bot", "run:ticket-4711"]
        }
    },
)`;
  const heliconeUrl = `${app}${PATH}/helicone?key=lpk_...&client=${exampleClient}&project=support-bot`;
  const heliconeEnv = `# .env of the LLMpense server (HMAC key from the Helicone webhook)
HELICONE_WEBHOOK_SECRET=...`;
  const openrouterHeaders = `{
  "Authorization": "Bearer lpk_..."
}`;
  const openrouterRequest = `{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [{ "role": "user", "content": "Hello" }],
  "user": "user_12345",
  "trace": {
    "llmpense_client": "${exampleClient}",
    "llmpense_project": "support-bot",
    "llmpense_feature": "chat",
    "llmpense_run": "ticket-4711"
  }
}`;

  return (
    <Panel
      title="Import from an existing gateway"
      sub="Already routing traffic through LiteLLM, Helicone or OpenRouter? Have it send usage here. LLMpense prices each request from its own price table; the cost reported by the tool is kept in the event metadata."
    >
      <div className="space-y-5">
        <Tool
          id="litellm"
          name="LiteLLM proxy"
          endpoint={`${app}${PATH}/litellm`}
          auth={
            <>
              <code>Authorization: Bearer lpk_...</code> in the <code>generic_api</code> callback headers
            </>
          }
        >
          <CodeBlock label="config.yaml" code={litellmConfig} />
          <CodeBlock label="Attribution per request, Python" code={litellmRequest} />
        </Tool>

        <Tool
          id="helicone"
          name="Helicone webhooks"
          endpoint={`${app}${PATH}/helicone`}
          auth={
            <>
              Key as <code>?key=lpk_...</code> in the webhook URL. Enable <span className="font-medium">Include Data</span> so usage is sent.
            </>
          }
        >
          <CodeBlock label="Webhook destination URL" code={heliconeUrl} />
          <CodeBlock label="Optional: verify signatures" code={heliconeEnv} />
        </Tool>

        <Tool
          id="openrouter"
          name="OpenRouter Broadcast (Webhook destination)"
          endpoint={`${app}${PATH}/openrouter`}
          auth={<>Custom headers on the destination, method POST or PUT</>}
        >
          <CodeBlock label="Webhook headers" code={openrouterHeaders} />
          <CodeBlock label="Attribution per request" code={openrouterRequest} />
        </Tool>

        <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
          <p className="font-medium text-ink">How requests are attributed</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5">
            <li>
              Metadata keys <code>llmpense_client</code>, <code>llmpense_project</code>, <code>llmpense_feature</code> (LiteLLM request
              metadata, OpenRouter <code>trace</code>).
            </li>
            <li>
              Tags <code>client:&lt;slug&gt;</code>, <code>project:&lt;slug&gt;</code>, <code>feature:&lt;slug&gt;</code> (LiteLLM tags,
              OpenRouter <code>trace.tags</code>).
            </li>
            <li>
              Query parameters on the endpoint URL: <code>?client=</code>, <code>?project=</code>, <code>?feature=</code>.
            </li>
            <li>Client only: the tool&apos;s team or end user (LiteLLM team alias, then end user; Helicone user id; OpenRouter user).</li>
            <li>The API key&apos;s default client and project.</li>
          </ol>
          <p className="mt-2">
            The tool&apos;s request id is stored as <code>requestId</code>, so redelivered payloads are ignored.
          </p>
        </div>
      </div>
    </Panel>
  );
}
