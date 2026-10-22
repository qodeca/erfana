### Fixed

- **The context meter now recognises Claude models used through Amazon Bedrock and Google Cloud.**
  Model names such as `us.anthropic.claude-opus-4-8`, a Bedrock ARN or `claude-haiku-4-5@20251001`
  get the same window size and friendly name as the plain Claude name, and a `/model` choice that
  uses one is honoured. When Erfana cannot read a model name – including plain names outside its
  grammar, such as `claude-3-7-sonnet-20250219` or the alias `opus` – the meter now marks its 200k
  size as `(inferred)` instead of showing it as fact. A Bedrock ARN no longer shows your AWS
  account number in the model label. (#49)
