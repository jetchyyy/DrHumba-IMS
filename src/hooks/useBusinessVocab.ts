/**
 * useBusinessVocab — returns terminology adapted to the tenant's business type.
 *
 * Priority: restaurant > retail > service > generic (fallback)
 *
 * Usage:
 *   const vocab = useBusinessVocab();
 *   vocab.cogsLabel        // "Food Cost (COGS)" | "Cost of Goods (COGS)" | "Parts & Labor Cost"
 *   vocab.saleCategories   // ["Dine in", "Grab", …] | ["Walk-in", "Online Order", …]
 */

import { useTenant } from '../contexts/TenantContext';

export interface BusinessVocab {
  // Page / section labels
  posTitle: string;
  posDescription: string;
  itemUnit: string;           // singular: "dish" | "product" | "service/item"
  itemUnitPlural: string;     // plural: "dishes" | "products" | "services"

  // Analytics labels
  analyticsDescription: string;
  cogsLabel: string;          // "Food Cost (COGS)" | "Cost of Goods (COGS)" | "Parts & Labor Cost"
  cogsRatioLabel: string;     // "Food Cost Ratio" | "COGS Ratio" | "Cost Ratio"
  cogsRatioNote: (pct: string) => string;
  wasteLabel: string;         // "Waste & Spoilage" | "Damages & Losses"
  wasteNote: string;          // "From damages & spoilage logs" | "From damage & loss adjustments"
  profitNote: string;         // "Est. Revenue – COGS – Wastage"
  topSellingLabel: string;    // "Top Selling Dishes" | "Top Selling Products" | "Top Selling Services"
  noSalesNote: string;        // "No product sales logged…"
  wastageChartLabel: string;  // "Wastage Breakdown (₱)" | "Damage Breakdown (₱)"
  noWasteNote: string;        // "No spoilage/damage adjustments recorded."
  ordersUnit: string;         // "orders" | "transactions" | "jobs"
  loadingLabel: string;       // "Loading restaurant analytics…" | "Loading analytics…"

  // POS sale category options
  saleCategories: Array<{ value: string; label: string }>;
  defaultSaleCategory: string;
}

export const useBusinessVocab = (): BusinessVocab => {
  const { tenant } = useTenant();

  const isRestaurant = tenant?.is_restaurant ?? true;
  const isRetail     = tenant?.is_retail     ?? false;
  const isService    = tenant?.is_service    ?? false;

  // ── Restaurant ──────────────────────────────────────────────────────────────
  if (isRestaurant) {
    return {
      posTitle: 'Point of Sale',
      posDescription: 'Tap dishes to add to cart. Inventory deductions are validated at the database layer.',
      itemUnit: 'dish',
      itemUnitPlural: 'dishes',

      analyticsDescription: 'Track and compare sales, food cost ratios, and wastage across branches.',
      cogsLabel: 'Food Cost (COGS)',
      cogsRatioLabel: 'Food Cost Ratio',
      cogsRatioNote: (pct) => `${pct}% food ratio`,
      wasteLabel: 'Waste & Spoilage',
      wasteNote: 'From damages & spoilage logs',
      profitNote: 'Est. Revenue – COGS – Wastage',
      topSellingLabel: 'Top Selling Dishes',
      noSalesNote: 'No dish sales logged in this date range.',
      wastageChartLabel: 'Wastage Breakdown (₱)',
      noWasteNote: 'No spoilage/damage adjustments recorded.',
      ordersUnit: 'orders',
      loadingLabel: 'Loading restaurant analytics…',

      saleCategories: [
        { value: 'Dine in',    label: 'Dine In'    },
        { value: 'Take Out',   label: 'Take Out'   },
        { value: 'Grab',       label: 'Grab'       },
        { value: 'Foodpanda',  label: 'Foodpanda'  },
        { value: 'other',      label: 'Other (specify)' },
      ],
      defaultSaleCategory: 'Dine in',
    };
  }

  // ── Service shop only ────────────────────────────────────────────────────────
  if (isService && !isRetail) {
    return {
      posTitle: 'Service & Repair POS',
      posDescription: 'Charge customers for parts and labor. Each line item deducts from inventory automatically.',
      itemUnit: 'item',
      itemUnitPlural: 'items',

      analyticsDescription: 'Track revenue, parts cost, and damage losses across service branches.',
      cogsLabel: 'Parts & Labor Cost',
      cogsRatioLabel: 'Cost Ratio',
      cogsRatioNote: (pct) => `${pct}% of revenue`,
      wasteLabel: 'Damages & Losses',
      wasteNote: 'From damage & loss adjustments',
      profitNote: 'Est. Revenue – Parts/Labor – Damages',
      topSellingLabel: 'Top Billed Services',
      noSalesNote: 'No service jobs logged in this date range.',
      wastageChartLabel: 'Damage Breakdown (₱)',
      noWasteNote: 'No damage/loss adjustments recorded.',
      ordersUnit: 'jobs',
      loadingLabel: 'Loading service analytics…',

      saleCategories: [
        { value: 'Walk-in',     label: 'Walk-In'      },
        { value: 'Appointment', label: 'Appointment'  },
        { value: 'Pick-up',     label: 'Pick-Up'      },
        { value: 'other',       label: 'Other (specify)' },
      ],
      defaultSaleCategory: 'Walk-in',
    };
  }

  // ── Retail shop only ─────────────────────────────────────────────────────────
  if (isRetail && !isService) {
    return {
      posTitle: 'Point of Sale',
      posDescription: 'Tap products to add to cart. Stock deductions are validated at the database layer.',
      itemUnit: 'product',
      itemUnitPlural: 'products',

      analyticsDescription: 'Track and compare sales, cost of goods ratios, and damage losses across branches.',
      cogsLabel: 'Cost of Goods (COGS)',
      cogsRatioLabel: 'COGS Ratio',
      cogsRatioNote: (pct) => `${pct}% of revenue`,
      wasteLabel: 'Damages & Losses',
      wasteNote: 'From damage & loss adjustments',
      profitNote: 'Est. Revenue – COGS – Damages',
      topSellingLabel: 'Top Selling Products',
      noSalesNote: 'No product sales logged in this date range.',
      wastageChartLabel: 'Damage Breakdown (₱)',
      noWasteNote: 'No damage/loss adjustments recorded.',
      ordersUnit: 'transactions',
      loadingLabel: 'Loading sales analytics…',

      saleCategories: [
        { value: 'Walk-in',      label: 'Walk-In'       },
        { value: 'Online Order', label: 'Online Order'  },
        { value: 'Delivery',     label: 'Delivery'      },
        { value: 'other',        label: 'Other (specify)' },
      ],
      defaultSaleCategory: 'Walk-in',
    };
  }

  // ── Retail + Service (hybrid, e.g. bike shop selling parts AND doing repairs) ─
  if (isRetail && isService) {
    return {
      posTitle: 'Point of Sale',
      posDescription: 'Sell products and bill services in one transaction. Inventory deductions are automatic.',
      itemUnit: 'item',
      itemUnitPlural: 'items',

      analyticsDescription: 'Track sales, cost of goods, parts/labor costs, and damage losses across branches.',
      cogsLabel: 'Cost of Goods & Labor',
      cogsRatioLabel: 'Cost Ratio',
      cogsRatioNote: (pct) => `${pct}% of revenue`,
      wasteLabel: 'Damages & Losses',
      wasteNote: 'From damage & loss adjustments',
      profitNote: 'Est. Revenue – COGS – Damages',
      topSellingLabel: 'Top Selling Items & Services',
      noSalesNote: 'No sales or service jobs logged in this date range.',
      wastageChartLabel: 'Damage Breakdown (₱)',
      noWasteNote: 'No damage/loss adjustments recorded.',
      ordersUnit: 'transactions',
      loadingLabel: 'Loading analytics…',

      saleCategories: [
        { value: 'Walk-in',      label: 'Walk-In'       },
        { value: 'Appointment',  label: 'Appointment'   },
        { value: 'Online Order', label: 'Online Order'  },
        { value: 'Pick-up',      label: 'Pick-Up'       },
        { value: 'other',        label: 'Other (specify)' },
      ],
      defaultSaleCategory: 'Walk-in',
    };
  }

  // ── Fallback (generic) ───────────────────────────────────────────────────────
  return {
    posTitle: 'Point of Sale',
    posDescription: 'Tap items to add to cart. Inventory deductions are validated at the database layer.',
    itemUnit: 'item',
    itemUnitPlural: 'items',

    analyticsDescription: 'Track and compare sales, cost ratios, and losses across branches.',
    cogsLabel: 'Cost of Goods (COGS)',
    cogsRatioLabel: 'Cost Ratio',
    cogsRatioNote: (pct) => `${pct}% of revenue`,
    wasteLabel: 'Damages & Losses',
    wasteNote: 'From damage & loss adjustments',
    profitNote: 'Est. Revenue – COGS – Losses',
    topSellingLabel: 'Top Selling Items',
    noSalesNote: 'No sales logged in this date range.',
    wastageChartLabel: 'Loss Breakdown (₱)',
    noWasteNote: 'No damage/loss adjustments recorded.',
    ordersUnit: 'transactions',
    loadingLabel: 'Loading analytics…',

    saleCategories: [
      { value: 'Walk-in',  label: 'Walk-In'         },
      { value: 'other',    label: 'Other (specify)'  },
    ],
    defaultSaleCategory: 'Walk-in',
  };
};
