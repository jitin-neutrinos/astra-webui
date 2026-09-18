// The ONE place the /model switch string is built. Grammar verified against
// hermes_cli/model_switch.py parse_model_switch_args: "<model> --provider <p> --session".
export function modelSwitchValue({ provider, model }: { provider: string; model: string }): string {
  return `${model} --provider ${provider} --session`;
}
