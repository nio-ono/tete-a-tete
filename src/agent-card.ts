/**
 * Agent Card generation for A2A protocol
 */

import type { AgentCard, AgentSkill } from "./types.js";

export interface AgentCardOptions {
  name: string;
  description?: string;
  url: string;
  skills?: AgentSkill[];
}

/**
 * Generate an A2A Agent Card
 */
export function generateAgentCard(options: AgentCardOptions): AgentCard {
  const defaultSkills: AgentSkill[] = [
    {
      id: "message",
      name: "Receive Message",
      description: "Receive a text message from another agent",
    },
  ];

  return {
    name: options.name,
    description: options.description,
    url: options.url,
    version: "1.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: options.skills ?? defaultSkills,
  };
}
