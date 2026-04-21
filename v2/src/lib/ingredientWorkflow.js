export function resolveImportSourceRowState(
  row = {},
  {
    ingredients = [],
    ignoredImportRows = {},
    resolvedImportRows = {},
    sourceCodeRedirectState = {},
    searchableIngredients = null,
    searchContext = {},
    buildIgnoredImportRowKey,
    isImportRowIgnored,
    isImportRowResolved,
    findAnyImportCoverageOwner,
    findTrustedImportCoverageTarget,
    findLiveImportCoverageTarget,
    isImportCoverageTargetSearchable,
  } = {}
) {
  const rowKey = buildIgnoredImportRowKey(row?.sourceCode, row?.rawName);
  const ignored = isImportRowIgnored(row, ignoredImportRows);
  const resolved = isImportRowResolved(row, resolvedImportRows);
  const ownerTarget = findAnyImportCoverageOwner(row, ingredients, sourceCodeRedirectState);
  const trustedTarget = findTrustedImportCoverageTarget(row, ingredients, sourceCodeRedirectState);
  const liveTarget = findLiveImportCoverageTarget(row, ingredients, sourceCodeRedirectState);
  const searchableTarget = Array.isArray(searchableIngredients)
    ? findLiveImportCoverageTarget(row, searchableIngredients, sourceCodeRedirectState)
    : liveTarget;
  const searchable =
    searchableTarget && Array.isArray(searchableIngredients)
      ? isImportCoverageTargetSearchable(row, searchableTarget, {
          ...searchContext,
          redirectState: sourceCodeRedirectState,
        })
      : Boolean(searchableTarget);

  if (ignored) {
    return {
      row,
      rowKey,
      state: "ignored",
      issueKind: "",
      ignored,
      resolved,
      ownerTarget,
      trustedTarget,
      liveTarget,
      searchableTarget,
      searchable,
      targetIngredient: searchableTarget || liveTarget || trustedTarget || ownerTarget || null,
    };
  }

  if (resolved) {
    const issueKind = !liveTarget ? "resolved_without_target" : !searchable ? "target_not_searchable" : "";
    return {
      row,
      rowKey,
      state: issueKind ? "coverage_issue" : "resolved",
      issueKind,
      ignored,
      resolved,
      ownerTarget,
      trustedTarget,
      liveTarget,
      searchableTarget,
      searchable,
      targetIngredient: searchableTarget || liveTarget || trustedTarget || ownerTarget || null,
    };
  }

  if (trustedTarget) {
    const issueKind = !liveTarget ? "represented_without_target" : !searchable ? "target_not_searchable" : "";
    return {
      row,
      rowKey,
      state: issueKind ? "coverage_issue" : "represented",
      issueKind,
      ignored,
      resolved,
      ownerTarget,
      trustedTarget,
      liveTarget,
      searchableTarget,
      searchable,
      targetIngredient: searchableTarget || liveTarget || trustedTarget || ownerTarget || null,
    };
  }

  if (ownerTarget) {
    return {
      row,
      rowKey,
      state: "coverage_issue",
      issueKind: "represented_without_target",
      ignored,
      resolved,
      ownerTarget,
      trustedTarget,
      liveTarget,
      searchableTarget,
      searchable,
      targetIngredient: searchableTarget || liveTarget || trustedTarget || ownerTarget || null,
    };
  }

  return {
    row,
    rowKey,
    state: "review",
    issueKind: "",
    ignored,
    resolved,
    ownerTarget,
    trustedTarget,
    liveTarget,
    searchableTarget,
    searchable,
    targetIngredient: searchableTarget || liveTarget || trustedTarget || ownerTarget || null,
  };
}

export function resolveImportSourceRows(rows = [], options = {}) {
  return (rows || []).map((row) => resolveImportSourceRowState(row, options));
}

export function summarizeResolvedImportSourceRows(
  resolutions = [],
  {
    queueRows = [],
    buildIgnoredImportRowKey,
  } = {}
) {
  const totalSourceRows = (resolutions || []).length;
  let ignoredCount = 0;
  let resolvedCount = 0;
  let representedCount = 0;

  const queueRowKeys = new Set(
    (queueRows || [])
      .map((row) => buildIgnoredImportRowKey(row?.sourceCode, row?.rawName))
      .filter(Boolean)
  );

  (resolutions || []).forEach((resolution) => {
    if (resolution.state === "ignored") {
      ignoredCount += 1;
      return;
    }
    if (resolution.state === "resolved") {
      resolvedCount += 1;
      return;
    }
    if (resolution.state === "represented" && !queueRowKeys.has(resolution.rowKey)) {
      representedCount += 1;
    }
  });

  const sourceQueueRows = (queueRows || []).filter((row) => !row.published && !row.reconcileMode);
  const reconcileQueueRows = (queueRows || []).filter((row) => !row.published && row.reconcileMode);

  return {
    totalSourceRows,
    ignoredCount,
    resolvedCount,
    representedCount,
    filteredOutCount: ignoredCount + resolvedCount + representedCount,
    remainingSourceRows: Math.max(totalSourceRows - ignoredCount - resolvedCount - representedCount, 0),
    sourceQueueCount: sourceQueueRows.length,
    sourceQueueReviewCount: sourceQueueRows.filter((row) => row.reviewStatus === "review").length,
    sourceQueueReadyCount: sourceQueueRows.filter((row) => row.reviewStatus === "ready").length,
    reconcileQueueCount: reconcileQueueRows.length,
  };
}
