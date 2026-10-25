import type { PluginHostSummary } from "@getpaseo/plugin/client";

function serverIdOf(slot: number): string {
  return `Window-${slot}`;
}

export interface SlotState {
  slot: number;
  status: string;
  repo: string;
  runId: number | null;
  url: string | null;
  ageSeconds: number | null;
  booted: boolean | null;
}

export type HostState = "unpaired" | "connecting" | "online" | "offline";

export type WindowPhase = "free" | "starting" | "running";

export type RowActionKind = "pair" | "switch" | "turn-down";

export interface RowAction {
  kind: RowActionKind;
  label: string;
  disabled: boolean;
  danger: boolean;
}

export interface WindowRow {
  serverId: string;
  name: string;
  detail: string;
  runStatus: string;
  hostStatus: string | null;
  runUrl: string;
  actions: RowAction[];
}

export interface WindowRowsInput {
  slots: readonly SlotState[];
  hosts: readonly PluginHostSummary[];
  localHost: { id: string; label: string };
  materialImported: boolean;
  canSwitch: boolean;
}

function readableStatus(status: string): string {
  if (status === "in_progress") {
    return "Running";
  }
  if (status === "dispatching") {
    return "Starting";
  }
  if (status === "free") {
    return "Free";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function hostState(hosts: readonly PluginHostSummary[], serverId: string): HostState {
  const entry = hosts.find((host) => host.serverId === serverId);
  if (!entry) {
    return "unpaired";
  }
  if (entry.status === "online") {
    return "online";
  }
  if (entry.status === "connecting") {
    return "connecting";
  }
  return "offline";
}

function phaseOf(status: string): WindowPhase {
  if (status === "free") {
    return "free";
  }
  return status === "dispatching" ? "starting" : "running";
}

function formatAge(seconds: number | null): string {
  const elapsed = seconds ?? 0;
  return elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`;
}

function runStatusOf(phase: WindowPhase, status: string): string {
  return readableStatus(phase === "free" ? "free" : status);
}

function hostStatusOf(phase: WindowPhase, state: HostState, booted: boolean): string | null {
  if (phase !== "running") {
    return null;
  }
  if (state === "unpaired") {
    return booted ? "Not paired" : "Not booted";
  }
  if (state === "connecting") {
    return "Connecting";
  }
  return state === "online" ? "Paired" : "Offline";
}

function connectAction(
  phase: WindowPhase,
  state: HostState,
  booted: boolean,
  slot: number,
  materialImported: boolean,
  canSwitch: boolean,
): RowAction | null {
  if (phase !== "running") {
    return null;
  }
  if (state !== "unpaired") {
    return canSwitch
      ? {
          kind: "switch",
          label: `Switch to Window ${slot}`,
          disabled: state !== "online",
          danger: false,
        }
      : null;
  }
  return {
    kind: "pair",
    label: `Pair Window ${slot}`,
    disabled: !(booted && materialImported),
    danger: false,
  };
}

function turnDownAction(phase: WindowPhase): RowAction | null {
  if (phase === "free") {
    return null;
  }
  return { kind: "turn-down", label: "Turn down", disabled: phase === "starting", danger: true };
}

export function windowRows(input: WindowRowsInput): WindowRow[] {
  const slotStates = new Map(input.slots.map((entry) => [entry.slot, entry]));
  const windowEntries = [...slotStates.values()].map((slotState): WindowRow => {
    const phase = phaseOf(slotState.status);
    const serverId = serverIdOf(slotState.slot);
    const state = hostState(input.hosts, serverId);
    const booted = slotState.booted === true;
    const action = connectAction(
      phase,
      state,
      booted,
      slotState.slot,
      input.materialImported,
      input.canSwitch,
    );
    const turnDown = turnDownAction(phase);
    return {
      serverId,
      name: `Window ${slotState.slot}`,
      detail:
        phase === "free"
          ? `${serverId} · no active window`
          : `${slotState.repo} · ${phase === "starting" ? "starting for " : "for "}${formatAge(slotState.ageSeconds)}`,
      runStatus: runStatusOf(phase, slotState.status),
      hostStatus: hostStatusOf(phase, state, booted),
      runUrl: slotState.url ?? "",
      actions: [...(action ? [action] : []), ...(turnDown ? [turnDown] : [])],
    };
  });
  return [
    {
      serverId: input.localHost.id,
      name: input.localHost.label,
      detail: `Local daemon · ${input.localHost.id}`,
      runStatus: "Local",
      hostStatus: null,
      runUrl: "",
      actions: [],
    },
    ...windowEntries,
  ];
}
