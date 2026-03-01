/**
 * Configuration for an upstream MCP server to proxy prompts from.
 */
export interface UpstreamServerConfig {
  /** Display name for this server */
  name: string;
  /** Command to launch the MCP server */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
  /** Working directory for the server process */
  cwd?: string;
}

/**
 * Top-level configuration for the proxy.
 */
export interface ProxyConfig {
  /** List of upstream MCP servers whose prompts will be exposed as tools */
  servers: UpstreamServerConfig[];
}

/**
 * Information about a prompt discovered from an upstream server.
 */
export interface PromptInfo {
  /** Original prompt name */
  name: string;
  /** Description of the prompt */
  description?: string;
  /** Arguments the prompt accepts */
  arguments?: PromptArgument[];
  /** Which server this prompt came from */
  serverName: string;
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}
