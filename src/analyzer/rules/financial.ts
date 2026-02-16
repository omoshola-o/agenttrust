import type { RiskRule } from "../types.js";

const FINANCIAL_KEYWORDS = [
  "payment",
  "stripe",
  "paypal",
  "venmo",
  "banking",
  "checkout",
  "billing",
  "invoice",
  "transaction",
];

export const paymentDetected: RiskRule = {
  id: "fin-001",
  name: "payment_detected",
  category: "financial",
  severity: "high",
  description: "Detects payment-related actions (payment.initiate, payment.confirm)",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type.startsWith("payment.")) {
      return {
        ruleId: "fin-001",
        severity: "high",
        reason: `Payment action detected: ${entry.action.type} targeting ${entry.action.target}`,
        riskContribution: 8,
        labels: ["financial"],
      };
    }
    return null;
  },
};

export const financialApiCall: RiskRule = {
  id: "fin-002",
  name: "financial_api_call",
  category: "financial",
  severity: "high",
  description: "Detects API calls to financial services (Stripe, PayPal, etc.)",
  enabledByDefault: true,
  evaluate(entry) {
    if (entry.action.type !== "api.call") return null;
    const target = entry.action.target.toLowerCase();
    const matched = FINANCIAL_KEYWORDS.find((kw) => target.includes(kw));
    if (matched) {
      return {
        ruleId: "fin-002",
        severity: "high",
        reason: `API call to financial service: ${entry.action.target} (matched keyword: ${matched})`,
        riskContribution: 7,
        labels: ["financial"],
      };
    }
    return null;
  },
};

export const financialRules: RiskRule[] = [paymentDetected, financialApiCall];
