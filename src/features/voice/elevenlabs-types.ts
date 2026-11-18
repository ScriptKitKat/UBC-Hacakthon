export interface ToolParameterProperty {
  readonly type: "string" | "number" | "integer" | "boolean";
  readonly description: string;
  readonly enum?: readonly string[];
}

export interface ToolParameters {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolParameterProperty>>;
  readonly required?: readonly string[];
}

export interface ClientToolConfig {
  readonly type: "client";
  readonly name: string;
  readonly description: string;
  readonly expects_response: true;
  readonly response_timeout_secs: number;
  readonly parameters?: ToolParameters;
}

export type EnglishTtsModel = "eleven_flash_v2" | "eleven_turbo_v2";

export interface AgentConfig {
  readonly name: string;
  readonly conversation_config: {
    readonly agent: {
      readonly first_message: string;
      readonly language: "en";
      readonly prompt: {
        readonly prompt: string;
        readonly llm: "gpt-4.1";
        readonly temperature: number;
        readonly tool_ids: readonly string[];
      };
    };
    readonly tts: {
      readonly model_id: EnglishTtsModel;
      readonly voice_id: string;
    };
  };
}

export interface ToolSummary {
  readonly id: string;
  readonly name: string;
}

export type AdminError =
  | { readonly kind: "network" }
  | { readonly kind: "http"; readonly status: number; readonly message?: string }
  | { readonly kind: "parse" };
