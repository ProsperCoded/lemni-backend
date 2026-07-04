import { Injectable } from '@nestjs/common';

@Injectable()
export class ProrationService {
  /**
   * Calculates the proration adjustment amount when upgrading/downgrading plans mid-cycle.
   * Starts a new cycle immediately, applying credit from the unused portion of the current cycle.
   */
  calculateAdjustment(
    currentPlanAmount: number,
    newPlanAmount: number,
    periodStart: Date,
    periodEnd: Date,
    changeDate: Date,
  ): {
    unusedCredit: number;
    netCharge: number;
    unusedFraction: number;
  } {
    const totalDuration = periodEnd.getTime() - periodStart.getTime();
    const unusedDuration = periodEnd.getTime() - changeDate.getTime();

    if (totalDuration <= 0 || unusedDuration <= 0) {
      return { unusedCredit: 0, netCharge: newPlanAmount, unusedFraction: 0 };
    }

    // Fraction of the cycle that is remaining and unused
    const unusedFraction = Math.min(
      1,
      Math.max(0, unusedDuration / totalDuration),
    );

    // Unused credit rounded to 2 decimal places
    const unusedCredit =
      Math.round(currentPlanAmount * unusedFraction * 100) / 100;

    // Net charge to pay immediately (cannot be negative)
    const netCharge = Math.max(
      0,
      Math.round((newPlanAmount - unusedCredit) * 100) / 100,
    );

    return {
      unusedCredit,
      netCharge,
      unusedFraction,
    };
  }
}
