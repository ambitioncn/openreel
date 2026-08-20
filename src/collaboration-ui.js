export function collaborationConflictView(error) {
  if (error?.code !== "VERSION_CONFLICT") return null;
  const expectedVersion = error.details?.expectedVersion ?? error.details?.expected;
  return {
    title: "A newer collaborative edit is available.",
    message: Number.isSafeInteger(expectedVersion)
      ? `Your edit was not applied. The shared document is now at version ${expectedVersion}.`
      : "Your edit was not applied because the shared document changed.",
    action: "Load latest version"
  };
}
