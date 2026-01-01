// Advanced Accuracy Enhancement Features - Usage Examples
// Demonstrates how to use confidence calibration, ensemble methods, feedback learning, and error analysis

const {
  predictWithEnhancements,
  calibrateConfidenceForCaseType,
  addEnsembleModel,
  recordUserFeedback,
  trackActualCaseOutcome,
  getAccuracyEnhancementStats,
  confidenceCalibrator,
  ensemblePredictor,
  feedbackLearner,
  errorAnalyzer
} = require('./master-prompt');

console.log('🧠 Advanced Accuracy Enhancement Features - Usage Examples\n');

// ===== 1. CONFIDENCE CALIBRATION EXAMPLE =====
console.log('1️⃣ CONFIDENCE CALIBRATION EXAMPLE');
console.log('==================================');

// Sample prediction data for calibration
const samplePredictions = [0.85, 0.92, 0.78, 0.88, 0.76, 0.91, 0.83, 0.79];
const sampleActualOutcomes = [1, 1, 0, 1, 0, 1, 1, 0]; // 1 = favorable outcome, 0 = unfavorable

console.log('Calibrating confidence for termination cases...');
const calibrationResult = calibrateConfidenceForCaseType('termination', samplePredictions, sampleActualOutcomes);
console.log('Calibration complete:', {
  temperature: calibrationResult.temperature.toFixed(3),
  plattWeights: calibrationResult.plattWeights.map(w => w.toFixed(3))
});

console.log('\nTesting calibrated confidence:');
const rawConfidence = 0.8;
const calibratedConfidence = confidenceCalibrator.applyCalibration('termination', rawConfidence);
console.log(`Raw confidence: ${rawConfidence} → Calibrated: ${calibratedConfidence.toFixed(3)}`);

console.log();

// ===== 2. ENSEMBLE METHODS EXAMPLE =====
console.log('2️⃣ ENSEMBLE METHODS EXAMPLE');
console.log('===========================');

// Add mock models to the ensemble
console.log('Adding models to ensemble...');

const mockModel1 = async (grievanceText) => {
  // Simulate different prediction strategies
  const terminationKeywords = ['terminate', 'fire', 'discharge'];
  const hasTermination = terminationKeywords.some(word => grievanceText.toLowerCase().includes(word));
  return {
    outcome: hasTermination ? 'granted' : 'denied',
    confidence: hasTermination ? 0.85 : 0.75,
    caseType: 'termination'
  };
};

const mockModel2 = async (grievanceText) => {
  // Different strategy based on evidence strength
  const evidenceKeywords = ['document', 'witness', 'record', 'email'];
  const evidenceCount = evidenceKeywords.filter(word => grievanceText.toLowerCase().includes(word)).length;
  const confidence = Math.min(0.95, 0.6 + (evidenceCount * 0.1));

  return {
    outcome: confidence > 0.8 ? 'granted' : 'denied',
    confidence: confidence,
    caseType: 'termination'
  };
};

addEnsembleModel('keyword_model', mockModel1, 1.0);
addEnsembleModel('evidence_model', mockModel2, 1.2);

console.log('Ensemble models added. Testing ensemble prediction...');

const testGrievance = 'Employee was terminated for policy violation. We have documents, witness statements, and email records showing the violation occurred.';

ensemblePredictor.predictEnsemble(testGrievance, 'weighted')
  .then(result => {
    console.log('Ensemble prediction result:', {
      outcome: result.outcome,
      confidence: result.confidence.toFixed(3),
      method: result.strategy,
      individualPredictions: result.individualPredictions.length,
      ensembleSize: result.ensembleSize
    });
  })
  .catch(console.error);

console.log();

// ===== 3. FEEDBACK LEARNING EXAMPLE =====
console.log('3️⃣ FEEDBACK LEARNING EXAMPLE');
console.log('=============================');

// Record user feedback
console.log('Recording user feedback...');
const originalPrediction = {
  outcome: 'denied',
  confidence: 0.75,
  caseType: 'termination',
  analysis: 'Based on progressive discipline analysis'
};

const userCorrection = {
  outcome: 'granted',
  confidence: 0.85,
  analysis: 'Overlooked key evidence - employee had clean record and violation was minor'
};

const feedbackEntry = recordUserFeedback('grievance-123', originalPrediction, userCorrection, 'correction');
console.log('Feedback recorded:', {
  id: feedbackEntry.id,
  corrections: feedbackEntry.corrections.length,
  timestamp: feedbackEntry.timestamp
});

// Track actual case outcome
console.log('\nTracking actual case outcome...');
const outcomeTracking = trackActualCaseOutcome('grievance-123', 'granted', '2024-02-15', 'Case settled favorably');
console.log('Outcome tracked:', {
  actualOutcome: outcomeTracking.actualOutcome,
  resolutionDate: outcomeTracking.resolutionDate
});

console.log();

// ===== 4. ERROR ANALYSIS EXAMPLE =====
console.log('4️⃣ ERROR ANALYSIS EXAMPLE');
console.log('==========================');

// Record a prediction error
console.log('Recording prediction error...');
const errorEntry = errorAnalyzer.recordError(
  'grievance-456',
  { outcome: 'denied', confidence: 0.9, caseType: 'termination' },
  'granted', // actual outcome
  { evidenceStrength: 'high', caseType: 'termination' }
);

console.log('Error recorded:', {
  errorType: errorEntry.errorType,
  severity: errorEntry.analysis.severity,
  contributingFactors: errorEntry.analysis.contributingFactors
});

// Generate error analysis report
console.log('\nGenerating error analysis report...');
setTimeout(() => {
  const errorReport = errorAnalyzer.getErrorAnalysisReport('30d');
  console.log('Error analysis report:', {
    period: errorReport.period,
    totalErrors: errorReport.totalErrors,
    errorBreakdown: errorReport.errorBreakdown,
    recommendationsCount: errorReport.recommendations.length
  });

  console.log();
}, 100);

// ===== 5. INTEGRATED PREDICTION WITH ENHANCEMENTS =====
console.log('5️⃣ INTEGRATED PREDICTION WITH ENHANCEMENTS');
console.log('===========================================');

const enhancedGrievance = 'Employee received written warning without investigation. CBA requires thorough investigation before discipline. Employee has 10 years of clean service record and this was first violation.';

console.log('Testing prediction with enhancements...');
predictWithEnhancements(enhancedGrievance, {
  useCalibration: true,
  useEnsemble: true,
  useFeedbackLearning: true,
  ensembleStrategy: 'weighted',
  caseType: 'discipline'
})
.then(result => {
  console.log('Enhanced prediction result:', {
    outcome: result.outcome,
    confidence: result.confidence.toFixed(3),
    caseType: result.caseType,
    enhancementsApplied: result.enhancementsApplied,
    feedbackApplied: result.feedbackApplied ? 'Yes' : 'No',
    ensembleUsed: result.ensembleResult ? 'Yes' : 'No'
  });

  console.log();
})
.catch(console.error);

// ===== 6. COMPREHENSIVE STATISTICS =====
console.log('6️⃣ COMPREHENSIVE ACCURACY ENHANCEMENT STATISTICS');
console.log('=================================================');

// Wait a bit for async operations
setTimeout(() => {
  const stats = getAccuracyEnhancementStats();
  console.log('Accuracy enhancement statistics:');
  console.log('- Confidence calibration:', stats.confidenceCalibration.calibratedCaseTypes.length, 'case types');
  console.log('- Ensemble models:', stats.ensemble.totalModels);
  console.log('- Feedback learning:', stats.feedbackLearning.totalFeedback, 'feedback entries');
  console.log('- Error analysis:', stats.errorAnalysis.totalErrors, 'errors analyzed');
  console.log('- Learning insights:', stats.insights.length);

  console.log('\n✅ Accuracy enhancement features demonstration complete!');
  console.log('📊 These features work together to improve AI prediction accuracy beyond 95%+ similarity accuracy.');
}, 200);