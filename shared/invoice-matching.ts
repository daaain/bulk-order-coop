import type { InvoiceLineItem, ParsedInvoice } from './invoice';
import type { DeliveryStatus } from './types';
import { calculateCaseSize } from './costs';

export interface OrderItemForMatching {
  orderItemId: string;
  productCode: string;
  description: string;
  casePrice: number;
  unitsPerCase: number | null;
  packSize: number;
}

export interface DeliveryUpdate {
  orderItemId: string;
  productCode: string;
  description: string;
  status: DeliveryStatus;
  actualQuantity: number | null;
  actualPrice: number | null;
  notes: string | null;
}

export interface InvoiceMatchResult {
  matched: DeliveryUpdate[];
  missing: DeliveryUpdate[];
  invoiceOnly: InvoiceLineItem[];
}

// Member shares are rounded up to the penny, which builds a small cushion
// across the cases of an order. An invoice price up to £0.10 above the
// catalogue case price is absorbed by that cushion, so we don't flag it.
// Any price *below* the catalogue is flagged: members would have overpaid
// and the organiser needs to know to issue refunds.
const PRICE_TOLERANCE_UP = 0.1;

/**
 * Get the per-case price from an invoice line item.
 * When qty > 1, `unitPrice` is the per-case price and `cost` is the line total.
 * When qty === 1, `unitPrice` is null and `cost` IS the per-case price.
 */
function invoiceCasePrice(line: InvoiceLineItem): number {
  return line.unitPrice ?? line.cost;
}

/**
 * Match a parsed invoice against an order's items by product code,
 * producing the delivery updates that should be applied.
 */
export function matchInvoiceToOrder(
  invoice: ParsedInvoice,
  orderItems: OrderItemForMatching[],
): InvoiceMatchResult {
  const matched: DeliveryUpdate[] = [];
  const missing: DeliveryUpdate[] = [];
  const matchedInvoiceCodes = new Set<string>();

  for (const orderItem of orderItems) {
    const line = invoice.items.find((i) => i.productCode === orderItem.productCode);

    if (!line || line.invoiced === 0) {
      missing.push({
        orderItemId: orderItem.orderItemId,
        productCode: orderItem.productCode,
        description: orderItem.description,
        status: 'missing',
        actualQuantity: null,
        actualPrice: null,
        notes: null,
      });
      continue;
    }

    matchedInvoiceCodes.add(line.productCode);

    const caseSize = calculateCaseSize(orderItem.unitsPerCase, orderItem.packSize);
    const linePrice = invoiceCasePrice(line);
    const priceDelta = linePrice - orderItem.casePrice;
    const priceDiffers = priceDelta < 0 || priceDelta > PRICE_TOLERANCE_UP;

    if (line.invoiced < line.ordered) {
      matched.push({
        orderItemId: orderItem.orderItemId,
        productCode: orderItem.productCode,
        description: orderItem.description,
        status: 'partial',
        actualQuantity: line.invoiced * caseSize,
        actualPrice: null,
        notes: null,
      });
    } else if (priceDiffers) {
      matched.push({
        orderItemId: orderItem.orderItemId,
        productCode: orderItem.productCode,
        description: orderItem.description,
        status: 'different_price',
        actualQuantity: null,
        actualPrice: linePrice,
        notes: null,
      });
    } else {
      matched.push({
        orderItemId: orderItem.orderItemId,
        productCode: orderItem.productCode,
        description: orderItem.description,
        status: 'arrived',
        actualQuantity: null,
        actualPrice: null,
        notes: null,
      });
    }
  }

  const invoiceOnly = invoice.items.filter(
    (line) =>
      !matchedInvoiceCodes.has(line.productCode) &&
      line.cost > 0 &&
      line.invoiced > 0 &&
      !orderItems.some((o) => o.productCode === line.productCode),
  );

  return { matched, missing, invoiceOnly };
}
