// Advanced Accuracy Enhancement Features Test Suite
// Tests for Confidence Calibration, Ensemble Methods, Feedback Learning, and Error Analysis

const masterPrompt = require('../master-prompt');

const {
  ConfidenceCalibrator,
  EnsemblePredictor,
  FeedbackLearner,
  ErrorAnalyzer,
  predictWithEnhancements,
  addEnsembleModel,
  calibrateConfidenceForCaseType,
  recordUserFeedback,
  trackActualCaseOutcome,
  getAccuracyEnhancementStats
} = masterPrompt;

// Debug: Check what's actually imported
console.log('Available exports:', Object.keys(masterPrompt));
console.log('ConfidenceCalibrator type:', typeof ConfidenceCalibrator);
console.log('predictWithEnhancements type:', typeof predictWithEnhancements);

// Test data
const testPredictions = [0.8, 0.9, 0.7, 0.6, 0.85, 0.75, 0.95, 0.65, 0.88, 0.72];
const testActualOutcomes = [1, 1, 0, 1, 1, 0, 1, 0, 1, 0];

describe('Advanced Accuracy Enhancement Features', () => {

  describe('ConfidenceCalibrator', () => {
    let calibrator;

    beforeEach(() => {
      calibrator = new ConfidenceCalibrator();
    });

    test('should initialize with empty calibration data', () => {
      expect(calibrator.calibrationData.size).toBe(0);
      expect(calibrator.temperatureScalers.size).toBe(0);
      expect(calibrator.plattScalers.size).toBe(0);
    });

    test('should calibrate temperature scaling', () => {
      const temperature = calibrator.calibrateTemperature(testPredictions, testActualOutcomes);
      expect(typeof temperature).toBe('number');
      expect(temperature).toBeGreaterThan(0.1);
      expect(temperature).toBeLessThan(2.0);
    });

    test('should calibrate Platt scaling', () => {
      const weights = calibrator.calibratePlatt(testPredictions, testActualOutcomes);
      expect(Array.isArray(weights)).toBe(true);
      expect(weights.length).toBe(2);
      expect(typeof weights[0]).toBe('number');
      expect(typeof weights[1]).toBe('number');
    });

    test('should calibrate confidence for case type', () => {
      const result = calibrator.calibrateConfidence('termination', testPredictions, testActualOutcomes);
      expect(result).toHaveProperty('temperature');
      expect(result).toHaveProperty('plattWeights');
      expect(calibrator.temperatureScalers.has('termination')).toBe(true);
      expect(calibrator.plattScalers.has('termination')).toBe(true);
    });

    test('should apply calibration to confidence scores', () => {
      // First calibrate
      calibrator.calibrateConfidence('termination', testPredictions, testActualOutcomes);

      // Then apply calibration
      const calibrated = calibrator.applyCalibration('termination', 0.8);
      expect(typeof calibrated).toBe('number');
      expect(calibrated).toBeGreaterThanOrEqual(0.01);
      expect(calibrated).toBeLessThanOrEqual(0.99);
    });

    test('should check if recalibration is needed', () => {
      expect(calibrator.needsRecalibration('termination', 0.85)).toBe(true);

      // Calibrate first
      calibrator.calibrateConfidence('termination', testPredictions, testActualOutcomes);

      // Should not need recalibration immediately
      const recentData = new Date();
      recentData.setDate(recentData.getDate() - 10); // 10 days ago

      // Mock the calibration date to be recent
      const data = calibrator.calibrationData.get('termination');
      data.lastCalibrated = recentData.toISOString();

      expect(calibrator.needsRecalibration('termination', 0.85)).toBe(false);

      // Should need recalibration if accuracy is low
      expect(calibrator.needsRecalibration('termination', 0.6)).toBe(true);
    });

    test('should get calibration statistics', () => {
      calibrator.calibrateConfidence('termination', testPredictions, testActualOutcomes);
      const stats = calibrator.getCalibrationStats('termination');

      expect(stats).toHaveProperty('caseType', 'termination');
      expect(stats).toHaveProperty('temperature');
      expect(stats).toHaveProperty('plattWeights');
      expect(stats).toHaveProperty('lastCalibrated');
      expect(stats).toHaveProperty('sampleSize', testPredictions.length);
    });
  });

  describe('EnsemblePredictor', () => {
    let ensemble;

    beforeEach(() => {
      ensemble = new EnsemblePredictor();
    });

    test('should initialize empty', () => {
      expect(ensemble.models.size).toBe(0);
      expect(ensemble.weights.size).toBe(0);
      expect(ensemble.performanceHistory.size).toBe(0);
    });

    test('should add models to ensemble', () => {
      const mockModel = jest.fn().mockResolvedValue({
        outcome: 'granted',
        confidence: 0.8,
        caseType: 'termination'
      });

      const stats = ensemble.addModel('model1', mockModel, 1.5);
      expect(ensemble.models.size).toBe(1);
      expect(ensemble.weights.get('model1')).toBe(1.5);
      expect(ensemble.performanceHistory.has('model1')).toBe(true);
    });

    test('should update model weights based on performance', () => {
      const mockModel = jest.fn();
      ensemble.addModel('model1', mockModel);

      ensemble.updateWeights('model1', 0.9, 0.85);
      expect(ensemble.weights.get('model1')).toBeGreaterThan(1.0);
    });

    test('should perform majority vote', () => {
      const predictions = [
        { modelId: 'model1', outcome: 'granted', confidence: 0.8 },
        { modelId: 'model2', outcome: 'denied', confidence: 0.7 },
        { modelId: 'model3', outcome: 'granted', confidence: 0.9 }
      ];

      const result = ensemble.majorityVote(predictions);
      expect(result.outcome).toBe('granted');
      expect(result.confidence).toBe(2/3);
      expect(result.method).toBe('majority');
    });

    test('should perform weighted vote', () => {
      ensemble.addModel('model1', () => {}, 1.0);
      ensemble.addModel('model2', () => {}, 2.0);

      const predictions = [
        { modelId: 'model1', outcome: 'granted', confidence: 0.8 },
        { modelId: 'model2', outcome: 'denied', confidence: 0.7 }
      ];

      const result = ensemble.weightedVote(predictions);
      expect(result.method).toBe('weighted');
      expect(typeof result.outcome).toBe('string');
      expect(typeof result.confidence).toBe('number');
    });

    test('should perform Bayesian ensemble combination', () => {
      const predictions = [
        { modelId: 'model1', outcome: 'granted', confidence: 0.8 },
        { modelId: 'model2', outcome: 'denied', confidence: 0.6 },
        { modelId: 'model3', outcome: 'granted', confidence: 0.9 }
      ];

      const result = ensemble.bayesianVote(predictions);
      expect(result.method).toBe('bayesian');
      expect(typeof result.outcome).toBe('string');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(1);
    });

    test('should get ensemble statistics', () => {
      ensemble.addModel('model1', () => {});
      const stats = ensemble.getEnsembleStats();

      expect(stats.totalModels).toBe(1);
      expect(stats.activeModels).toContain('model1');
      expect(stats.averageWeights).toHaveProperty('model1');
    });
  });

  describe('FeedbackLearner', () => {
    let learner;

    beforeEach(() => {
      learner = new FeedbackLearner();
    });

    test('should initialize with empty data', () => {
      expect(learner.feedbackDatabase.size).toBe(0);
      expect(learner.learningPatterns.size).toBe(0);
      expect(learner.correctionHistory.length).toBe(0);
    });

    test('should record user feedback', () => {
      const originalPrediction = {
        outcome: 'denied',
        confidence: 0.7,
        caseType: 'termination'
      };

      const userCorrection = {
        outcome: 'granted',
        confidence: 0.9
      };

      const feedback = learner.recordFeedback(
        'grievance-123',
        originalPrediction,
        userCorrection,
        'correction'
      );

      expect(feedback.grievanceId).toBe('grievance-123');
      expect(feedback.corrections).toBeDefined();
      expect(learner.correctionHistory.length).toBe(1);
    });

    test('should extract corrections from feedback', () => {
      const original = { outcome: 'denied', confidence: 0.6 };
      const corrected = { outcome: 'granted', confidence: 0.8 };

      const corrections = learner.extractCorrections(original, corrected);

      expect(corrections.length).toBe(2);
      expect(corrections[0].type).toBe('confidence_adjustment');
      expect(corrections[1].type).toBe('outcome_correction');
    });

    test('should apply learned corrections', () => {
      // First record some feedback
      const original = {
        outcome: 'denied',
        confidence: 0.6,
        caseType: 'termination'
      };

      const corrected = {
        outcome: 'granted',
        confidence: 0.8
      };

      learner.recordFeedback('griev-1', original, corrected);

      // Now test applying corrections
      const prediction = {
        outcome: 'denied',
        confidence: 0.6,
        caseType: 'termination'
      };

      const adjusted = learner.applyLearnedCorrections(prediction, 'termination');
      expect(adjusted.confidence).toBeGreaterThan(prediction.confidence);
    });

    test('should track actual case outcomes', () => {
      const outcome = learner.trackActualOutcome(
        'griev-1',
        'granted',
        '2024-01-15',
        'Settled favorably'
      );

      expect(outcome.actualOutcome).toBe('granted');
      expect(outcome.resolutionDate).toBe('2024-01-15');
      expect(outcome.notes).toBe('Settled favorably');
    });

    test('should generate learning statistics', () => {
      // Add some feedback first
      learner.recordFeedback('griev-1',
        { outcome: 'denied', confidence: 0.6, caseType: 'termination' },
        { outcome: 'granted', confidence: 0.8 }
      );

      const stats = learner.getLearningStats();
      expect(stats.totalFeedback).toBe(1);
      expect(stats.uniqueGrievances).toBe(1);
      expect(stats.learningPatterns).toBeGreaterThan(0);
    });
  });

  describe('ErrorAnalyzer', () => {
    let analyzer;

    beforeEach(() => {
      analyzer = new ErrorAnalyzer();
    });

    test('should initialize with proper thresholds', () => {
      expect(analyzer.errorHistory.length).toBe(0);
      expect(analyzer.errorPatterns.size).toBe(0);
      expect(analyzer.errorThresholds).toHaveProperty('highErrorRate', 0.15);
      expect(analyzer.errorThresholds).toHaveProperty('minSamplesForAnalysis', 10);
    });

    test('should classify error types', () => {
      const prediction = { outcome: 'granted', confidence: 0.8 };
      const actual = 'denied';

      const errorType = analyzer.classifyError(prediction, actual);
      expect(errorType).toBe('outcome_reversal');

      // Test confidence error
      const confError = analyzer.classifyError(
        { outcome: 'granted', confidence: 0.9 },
        'granted'
      );
      expect(confError).toBe('false_positive_confidence');
    });

    test('should analyze specific errors', () => {
      const prediction = { outcome: 'granted', confidence: 0.9 };
      const actual = 'denied';
      const context = { evidenceStrength: 'low', caseType: 'termination' };

      const analysis = analyzer.analyzeError(prediction, actual, context);

      expect(analysis.contributingFactors.length).toBeGreaterThan(0);
      expect(analysis.severity).toBeDefined();
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });

    test('should record and analyze prediction errors', () => {
      const prediction = { outcome: 'granted', confidence: 0.8, caseType: 'termination' };
      const actual = 'denied';
      const context = { evidenceStrength: 'medium' };

      const errorEntry = analyzer.recordError('griev-1', prediction, actual, context);

      expect(errorEntry.grievanceId).toBe('griev-1');
      expect(errorEntry.errorType).toBe('outcome_reversal');
      expect(analyzer.errorHistory.length).toBe(1);
    });

    test('should generate error analysis reports', () => {
      // Add some errors first
      analyzer.recordError('griev-1',
        { outcome: 'granted', confidence: 0.8, caseType: 'termination' },
        'denied'
      );

      const report = analyzer.getErrorAnalysisReport('30d');
      expect(report.totalErrors).toBe(1);
      expect(report.errorBreakdown).toHaveProperty('outcome_reversal');
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Integration Tests', () => {
    test('should integrate predictWithEnhancements function', async () => {
      const grievanceText = 'Employee was terminated for being 5 minutes late after receiving no prior warnings. CBA requires progressive discipline.';

      const result = await predictWithEnhancements(grievanceText, {
        useCalibration: false,
        useEnsemble: false,
        useFeedbackLearning: false
      });

      expect(result).toHaveProperty('outcome');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('caseType');
      expect(result).toHaveProperty('enhancementsApplied');
      expect(result.enhancementsApplied.calibration).toBe(false);
    });

    test('should calibrate confidence for case type', () => {
      const result = calibrateConfidenceForCaseType('termination', testPredictions, testActualOutcomes);
      expect(result).toHaveProperty('temperature');
      expect(result).toHaveProperty('plattWeights');
    });

    test('should record user feedback', () => {
      const original = { outcome: 'denied', confidence: 0.6 };
      const correction = { outcome: 'granted', confidence: 0.8 };

      const feedback = recordUserFeedback('griev-123', original, correction);
      expect(feedback).toHaveProperty('id');
      expect(feedback.grievanceId).toBe('griev-123');
    });

    test('should track actual case outcomes', () => {
      const outcome = trackActualCaseOutcome('griev-123', 'granted', '2024-01-15');
      expect(outcome.actualOutcome).toBe('granted');
      expect(outcome.resolutionDate).toBe('2024-01-15');
    });

    test('should get accuracy enhancement statistics', () => {
      // Add some test data first
      calibrateConfidenceForCaseType('termination', testPredictions, testActualOutcomes);

      const stats = getAccuracyEnhancementStats();
      expect(stats).toHaveProperty('confidenceCalibration');
      expect(stats).toHaveProperty('ensemble');
      expect(stats).toHaveProperty('feedbackLearning');
      expect(stats).toHaveProperty('errorAnalysis');
      expect(stats).toHaveProperty('insights');
      expect(stats).toHaveProperty('generatedAt');
    });
  });

  describe('Performance Tests', () => {
    test('should handle large datasets efficiently', () => {
      const largePredictions = Array(1000).fill(0).map(() => Math.random());
      const largeActuals = Array(1000).fill(0).map(() => Math.random() > 0.5 ? 1 : 0);

      const start = Date.now();
      const calibrator = new ConfidenceCalibrator();
      calibrator.calibrateConfidence('termination', largePredictions, largeActuals);
      const end = Date.now();

      expect(end - start).toBeLessThan(5000); // Should complete in less than 5 seconds
    });

    test('should maintain performance with multiple models', async () => {
      const ensemble = new EnsemblePredictor();

      // Add multiple mock models
      for (let i = 0; i < 10; i++) {
        const mockModel = jest.fn().mockResolvedValue({
          outcome: i % 2 === 0 ? 'granted' : 'denied',
          confidence: 0.7 + (i * 0.02)
        });
        ensemble.addModel(`model${i}`, mockModel);
      }

      const start = Date.now();
      const result = await ensemble.predictEnsemble('test grievance');
      const end = Date.now();

      expect(result.individualPredictions.length).toBe(10);
      expect(end - start).toBeLessThan(2000); // Should complete in less than 2 seconds
    });
  });

});