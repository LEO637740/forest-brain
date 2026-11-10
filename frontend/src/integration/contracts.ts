// Generated from src/contracts.js. Do not edit by hand. Run: node scripts/export-contracts.js

// Draft based on MH 09/10 documents; not the missing original harness-v1.ts.

export type Kind = "weather_window" | "tapping_angle" | "surface_action" | "growth_plan" | "market_scenario" | "pest_risk" | "industry_brief";

export type HarnessRequest = {
  requestId: string;
  kind: "weather_window" | "tapping_angle" | "surface_action" | "growth_plan" | "market_scenario" | "pest_risk" | "industry_brief";
  siteId: string;
  targetSnapshotId: string;
  inputSnapshot: {
    snapshotId: string;
    version: number;
  };
  executionMode: "simulation" | "live";
  trigger?: {
    type: "user" | "event" | "scheduled";
    eventId: string;
  };
  generatorMode?: "configured" | "demo_rules";
};

export type ContextSnapshot = {
  snapshotId: string;
  version: number;
  siteId: string;
  asOf: string;
  validUntil: string;
  executionMode: "simulation" | "live";
  targetSnapshot: {
    targetSnapshotId: string;
    siteId: string;
    treeIds: Array<string>;
  };
  constraints: {
    minCutSlopeDeg: number;
    maxCutSlopeDeg: number;
    maxTappingsPerWeek: number;
    ruleSetId: string;
  };
  modules: {
    industry?: {
      records: Array<{
        observationId: string;
        topic: string;
        title: string;
        scope: string;
        period: string;
        retrievedAt: string;
        expiresAt: string;
        sourceUrl: string;
        content: string;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      }>;
      gaps: Array<string>;
    };
    trees?: Array<{
      treeId: string;
      siteId: string;
      blockId: string;
      rowId?: string | null;
      variety: string | null;
      plantedAt: string | null;
      heightM: number | null;
      circumferenceCm: number | null;
      measuredAt: string | null;
      tappingStatus: "immature" | "available" | "resting" | "blocked" | "unknown";
      healthStatus: "normal" | "watch" | "confirmed_issue" | "unknown";
      fieldRecord?: {
        treeId: string;
        sourceTreeId?: string;
        variety: string | null;
        circumferenceCm: number | null;
        heightM: number | null;
        measurementHeightM: number | null;
        latitude?: number | null;
        longitude?: number | null;
        elevationM?: number | null;
        siteId: string;
        sourceName: string;
        observedAt: string;
        provenanceMode: "measured" | "simulated";
        coordinateSystem: "WGS84";
        recordId: string;
        importedAt: string;
        elevationDatum: string | null;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
      };
      provenance: {
        sourceId: string;
        sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
        mode: "measured" | "estimated" | "forecast" | "simulated";
        modelVersion?: string;
      };
      quality: "valid" | "suspect" | "missing";
    }>;
    weather?: {
      siteId: string;
      observed: {
        observationId: string;
        observedAt: string;
        receivedAt: string;
        airTemperatureC: number | null;
        relativeHumidityPct: number | null;
        rainfallMm: number | null;
        rainfallPeriodMinutes: number;
        soilMoisture?: {
          value?: number | null;
          unit?: string;
          provenance: {
            sourceId: string;
            sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
            mode: "measured" | "estimated" | "forecast" | "simulated";
            modelVersion?: string;
          };
          quality: "valid" | "suspect" | "missing";
        } | null;
        dryRubberContent?: {
          value?: number | null;
          unit?: string;
          provenance: {
            sourceId: string;
            sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
            mode: "measured" | "estimated" | "forecast" | "simulated";
            modelVersion?: string;
          };
          quality: "valid" | "suspect" | "missing";
        } | null;
        recentRainfall?: Array<{
          observationId: string;
          observedAt: string;
          rainfallMm: number | null;
          rainfallPeriodMinutes: number;
          provenance: {
            sourceId: string;
            sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
            mode: "measured" | "estimated" | "forecast" | "simulated";
            modelVersion?: string;
          };
          quality: "valid" | "suspect" | "missing";
        }>;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      } | null;
      forecast: {
        forecastRunId: string;
        issuedAt: string;
        issuedAtBasis?: "provider" | "retrieved";
        timezone: string;
        steps: Array<{
          validFrom: string;
          validTo: string;
          rainfallMm: number | null;
          rainProbabilityPct: number | null;
        }>;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      } | null;
    };
    inspection?: {
      evidence: Array<{
        evidenceId: string;
        treeId: string;
        capturedAt: string;
        imageUrl: string | null;
        imageWidthPx: number;
        imageHeightPx: number;
        expiresAt: string | null;
        geometryRegistered: boolean;
        detections: Array<{
          detectionId: string;
          classCode: "scar" | "attachment" | "suspected_lesion" | "nodule" | "bird_dropping" | "mud";
          intersectsPlannedLine: boolean | null;
          reviewStatus: "unreviewed" | "confirmed" | "rejected";
          score: number | null;
          box: Array<number>;
          coordinateConvention: "normalized_top_left_xywh";
        }>;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      }>;
    };
    tapping?: {
      panels: Array<{
        panelId: string;
        treeId: string;
        plannedCutSlopeDeg: number | null;
        actualCutSlopeDeg: number | null;
        angleReference: "horizontal";
        cutDirection: "left_to_right" | "right_to_left";
        latexViscosity?: {
          value?: number | null;
          unit?: string;
          provenance: {
            sourceId: string;
            sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
            mode: "measured" | "estimated" | "forecast" | "simulated";
            modelVersion?: string;
          };
          quality: "valid" | "suspect" | "missing";
        } | null;
        dryRubberContent?: {
          value?: number | null;
          unit?: string;
          provenance: {
            sourceId: string;
            sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
            mode: "measured" | "estimated" | "forecast" | "simulated";
            modelVersion?: string;
          };
          quality: "valid" | "suspect" | "missing";
        } | null;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      }>;
    };
    growth?: {
      measurements: Array<{
        observationId: string;
        treeId: string;
        observedAt: string;
        circumferenceCm: number | null;
        measurementHeightM: number;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      }>;
    };
    health?: {
      records: Array<{
        recordId: string;
        treeId: string;
        observedAt: string;
        symptomCodes: Array<string>;
        confirmedDiagnosis: {
          code: string;
          actorId: string;
          confirmedAt: string;
        } | null;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      }>;
    };
    market?: {
      instrument: string;
      venue: string;
      currency: "CNY";
      priceUnit: "CNY/kg_dry_rubber";
      prices: Array<{
        observationId: string;
        observedAt: string;
        value: number;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      }>;
      demand: {
        observationId: string;
        observedAt: string;
        value: number;
        baselineValue: number;
        unit: "index_0_100";
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      } | null;
      costAssumptions: {
        assumptionId: string;
        costPerTreeTappingCny: number;
        dryRubberKgPerTreeTapping: number | null;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      } | null;
    };
    knowledge?: {
      rules: Array<{
        ruleId: string;
        kind: "weather_window" | "tapping_angle" | "surface_action" | "growth_plan" | "market_scenario" | "pest_risk" | "industry_brief";
        title: string;
        text: string;
        version: string;
        validUntil: string;
        provenance: {
          sourceId: string;
          sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
          mode: "measured" | "estimated" | "forecast" | "simulated";
          modelVersion?: string;
        };
        quality: "valid" | "suspect" | "missing";
      }>;
    };
  };
  dataPolicy?: {
    mode: "demo" | "mixed_demo";
    notices: Array<string>;
    substitutions: Array<{
      module: string;
      reason: string;
      sourceId: string;
    }>;
  };
  sourceSnapshots?: Array<string>;
  sourceRequirements?: Array<{
    module: string;
    field: string;
    objectId: string;
    reason: string;
  }>;
  datasets?: Array<{
    module: "trees" | "inspection" | "tapping" | "growth" | "health" | "knowledge";
    datasetRef: string;
    version: number;
  }>;
};

export type WeatherWindowCandidate = {
  summary: string;
  reasons: Array<{
    text: string;
    sourceRefs: Array<string>;
  }>;
  evidenceRefs: Array<string>;
  proposal: {
    forecastRunId: string;
    windows: Array<{
      start: string;
      end: string;
      suitability: "suitable" | "defer" | "review";
      reason: string;
    }>;
    timingAssessment: {
      policyVersion: string;
      currentRainfallMm: number | null;
      recentRainfallTotalMm: number | null;
      recentRainfallPeakMm: number | null;
      soilMoisturePct: number | null;
      dryRubberContentPct: number | null;
      dryRubberStatus: "available_good" | "available_low" | "missing";
      wetSpell: boolean;
      soilWet: boolean;
      lightRainAllowed: boolean;
      thresholds: {
        lightRainMaxMmPerPeriod: number;
        rainProbabilityDeferPct: number;
        recentWetSpellMm: number;
        soilWetPct: number;
        dryRubberLowPct: number;
      };
      sourceRefs: Array<string>;
    };
    scheduleChanges: Array<{
      taskId: string;
      expectedVersion: number;
      previousWindow: {
        start: string;
        end: string;
      };
      proposedWindow: {
        start: string;
        end: string;
      };
    }>;
    excludedTreeIds: Array<string>;
  };
};

export type TappingAngleCandidate = {
  summary: string;
  reasons: Array<{
    text: string;
    sourceRefs: Array<string>;
  }>;
  evidenceRefs: Array<string>;
  proposal: {
    treeId: string;
    panelId: string;
    recommendedCutSlopeDeg: number;
    previousPlannedCutSlopeDeg: number | null;
    angleReference: "horizontal";
    cutDirection: "left_to_right" | "right_to_left";
    conditions: Array<string>;
    proposedPathRef: string | null;
    method: string;
    angleModel: {
      version: string;
      baselineDeg: number | null;
      unclampedCandidateDeg: number | null;
      adjustmentDeg: number;
      recommendedCutSlopeDeg: number | null;
      clamped: boolean;
      factors: Array<{
        key: string;
        label: string;
        inputValue: number | string | null;
        unit: string;
        deltaDeg: number;
        sourceId: string | null;
        provenanceMode: "measured" | "estimated" | "forecast" | "simulated" | "unknown";
        note: string;
      }>;
      dataCompletenessPct: number;
      confidence: "low" | "medium" | "high";
      optimizationStatus: "demo_heuristic" | "evidence_insufficient" | "validated";
      validity: "evidence_insufficient" | "validated";
      experimentPlan: Array<string>;
    };
  };
};

export type SurfaceActionCandidate = {
  summary: string;
  reasons: Array<{
    text: string;
    sourceRefs: Array<string>;
  }>;
  evidenceRefs: Array<string>;
  proposal: {
    findings: Array<{
      evidenceId: string;
      detectionId: string;
      treeId: string;
      affectsCut: "yes" | "no" | "unknown";
      action: "review" | "capture" | "manual_assessment" | "avoid_with_review" | "continue_with_review";
      reason: string;
    }>;
    followupSuggestions: Array<{
      treeId: string;
      taskType: "inspect" | "capture";
      reason: string;
    }>;
  };
};

export type GrowthPlanCandidate = {
  summary: string;
  reasons: Array<{
    text: string;
    sourceRefs: Array<string>;
  }>;
  evidenceRefs: Array<string>;
  proposal: {
    predictions: Array<{
      treeId: string;
      metric: "circumference_cm";
      at: string;
      value: number;
      interval: {
        lower: number;
        upper: number;
      } | null;
      method: string;
      sourceRefs: Array<string>;
    }>;
    futurePanelPlan: Array<{
      treeId: string;
      panelId: string;
      action: "review_before_rotation";
      reason: string;
    }>;
  };
};

export type MarketScenarioCandidate = {
  summary: string;
  reasons: Array<{
    text: string;
    sourceRefs: Array<string>;
  }>;
  evidenceRefs: Array<string>;
  proposal: {
    instrument: string;
    currency: "CNY";
    priceUnit: "CNY/kg_dry_rubber";
    assumptions: Array<string>;
    demandSignal: {
      band: "low" | "balanced" | "high" | "unknown";
      value: number | null;
      baselineValue: number | null;
      unit: "index_0_100";
      sourceId: string | null;
      provenanceMode: "measured" | "estimated" | "forecast" | "simulated" | "unknown";
    };
    eligibleTreeCount: number;
    excludedTreeCount: number;
    exclusions: Array<{
      reason: string;
      count: number;
    }>;
    targetFrequencyPerWeek: number;
    scenarios: Array<{
      scenarioId: string;
      tappingsPerWeek: number;
      eligibleTreeCount: number;
      expectedDryRubberKg: number | null;
      estimatedContributionCny: number | null;
      reason: string;
    }>;
    recommendedScenarioId: string | null;
  };
};

export type PestRiskCandidate = {
  summary: string;
  reasons: Array<{
    text: string;
    sourceRefs: Array<string>;
  }>;
  evidenceRefs: Array<string>;
  proposal: {
    horizon: {
      start: string;
      end: string;
    };
    findings: Array<{
      treeId: string;
      riskLevel: "watch" | "review";
      symptomCodes: Array<string>;
      reason: string;
      sourceRefs: Array<string>;
    }>;
    inspectionTargets: Array<string>;
    diagnosis: "not_diagnosed";
    riskAssessments: Array<{
      policyVersion: string;
      treeId: string;
      riskIndex: number;
      riskLevel: "low" | "watch" | "review";
      trend: "stable" | "increasing" | "insufficient_history";
      monitoringWindowDays: number;
      observedDays: number;
      basisSourceRefs: Array<string>;
      preventiveActions: Array<string>;
      limitation: string;
    }>;
  };
};

export type IndustryBriefCandidate = {
  summary: string;
  reasons: Array<{
    text: string;
    sourceRefs: Array<string>;
  }>;
  evidenceRefs: Array<string>;
  proposal: {
    horizon: {
      start: string;
      end: string;
    };
    findings: Array<{
      topic: string;
      assessment: string;
      sourceRefs: Array<string>;
      limitation: string;
    }>;
    recommendations: Array<{
      priority: "high" | "medium" | "low";
      action: string;
      reason: string;
      sourceRefs: Array<string>;
    }>;
    missingData: Array<string>;
    uncertainty: string;
    reviewRequired: true;
  };
};

export type CandidateByKind = {
  weather_window: WeatherWindowCandidate;
  tapping_angle: TappingAngleCandidate;
  surface_action: SurfaceActionCandidate;
  growth_plan: GrowthPlanCandidate;
  market_scenario: MarketScenarioCandidate;
  pest_risk: PestRiskCandidate;
  industry_brief: IndustryBriefCandidate;
};

export type StrategyHeader = {
  strategyId: string;
  revision: number;
  runId: string;
  siteId: string;
  targetSnapshotId: string;
  inputSnapshot: {
    snapshotId: string;
    version: number;
  };
  generatedAt: string;
  expiresAt: string;
  executionMode: "simulation" | "live";
  provenance: {
    sourceId: string;
    sourceClass: "sensor_device" | "web_service" | "research_partner" | "farmer_expert";
    mode: "measured" | "estimated" | "forecast" | "simulated";
    modelVersion?: string;
  };
  ruleVersion: string;
  modelVersion: string | null;
  schemaVersion?: string;
  qualityReview?: {
    status: "pending" | "withdrawn";
    reviewRequired: true;
    reviewedAt: string | null;
    notes: Array<string>;
  };
  dataPolicy?: {
    mode: "demo" | "mixed_demo";
    notices: Array<string>;
    substitutions: Array<{
      module: string;
      reason: string;
      sourceId: string;
    }>;
  };
  ruleBindings?: Array<{
    ruleId: string;
    version: string;
    contentHash: string;
  }>;
  generationMetadata?: {
    provider: string;
    model: string;
    promptVersion: string;
    responseId: string | null;
    promptHash: string;
    inputTokens: number | null;
    outputTokens: number | null;
    attempts: number;
  };
  fallback?: {
    reasonCode: string;
    message: string;
    details: Array<string>;
    generator: "demo_rules";
    reviewRequired: true;
  };
  constraintsChecked: Array<{
    code: string;
    status: "pass" | "fail" | "not_checked";
    message: string;
  }>;
};

export type Strategy = { [K in Kind]: StrategyHeader & { kind: K } & CandidateByKind[K] }[Kind];

export type Succeeded = {
  runId: string;
  requestId: string;
  status: "succeeded";
  updatedAt: string;
  strategy: Strategy;
};

export type NeedsData = {
  runId: string;
  requestId: string;
  status: "needs_data";
  updatedAt: string;
  missingData: Array<{
    module: string;
    field: string;
    objectId: string;
    reason: string;
  }>;
};

export type Failed = {
  runId: string;
  requestId: string;
  status: "failed";
  updatedAt: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Array<string>;
  };
};

export type HarnessResult = Succeeded | NeedsData | Failed;

export type RunProgress = {
  runId: string;
  requestId: string;
  status: "queued" | "running";
  stage: string;
  updatedAt: string;
};

export type RunAccepted = {
  runId: string;
  requestId: string;
  status: "queued" | "running" | "succeeded" | "needs_data" | "failed";
};

export type RunResponse = RunProgress | HarnessResult;
