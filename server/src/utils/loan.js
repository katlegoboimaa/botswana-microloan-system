import { fromThebe } from './money.js';

export function outstanding(loan) {
  const due = Number(loan.amountDueAtStart || 0) + Number(loan.chargesTotal || 0);
  return Math.max(0, due - Number(loan.paymentsTotal || 0));
}
export function remainingComponents(loan) {
  return {
    charges: Math.max(0, Number(loan.chargesTotal || 0) - Number(loan.chargesPaid || 0)),
    interest: Math.max(0, Number(loan.interest || 0) - Number(loan.interestPaid || 0)),
    principal: Math.max(0, Number(loan.principal || 0) - Number(loan.principalPaid || 0))
  };
}
export function loanSummary(loan) {
  const left = remainingComponents(loan);
  return {
    ...loan.toObject(),
    principalBWP: fromThebe(loan.principal),
    interestBWP: fromThebe(loan.interest),
    amountDueAtStartBWP: fromThebe(loan.amountDueAtStart),
    chargesTotalBWP: fromThebe(loan.chargesTotal),
    paymentsTotalBWP: fromThebe(loan.paymentsTotal),
    outstandingBWP: fromThebe(outstanding(loan)),
    remainingChargesBWP: fromThebe(left.charges),
    remainingInterestBWP: fromThebe(left.interest),
    remainingPrincipalBWP: fromThebe(left.principal)
  };
}
