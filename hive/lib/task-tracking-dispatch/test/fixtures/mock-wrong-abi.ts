// Mock adapter declaring an ABI major version Hive does not support.

export async function dispatch(req: { method: string; params?: any }): Promise<any> {
  if (req.method === "capabilities") {
    return {
      abi_version: "2.0.0",
      hierarchy: "flat",
      supports_parent_link: false,
      supported_labels: null,
      supported_states: ["open", "closed"],
      metadata: {},
    };
  }
  return {};
}
