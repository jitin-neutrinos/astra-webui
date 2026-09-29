// The ONE place the /model switch string is built. Grammar verified against
// hermes_cli/model_switch.py parse_model_switch_args: "<model> --provider <p> --session".
export function modelSwitchValue({ provider, model, effort }: { provider: string; model: string; effort?: string }): string {
  return `${model} --provider ${provider} --session${effort ? ` --reasoning ${effort}` : ""}`;
}
