export interface CatalogueItem {
  productCode: string;
  description: string;
  brand: string | null;
  organic: boolean;
  casePrice: number;
  vatRate: number;
  vatPerCase: number;
  unitsPerCase: number | null;
  packSize: number;
  unit: string;
  rrp: number | null;
  barcode: string | null;
  active: boolean;
  onOffer?: boolean;
}

export interface Order {
  id: string;
  name: string;
  catalogueKey: string;
  status: 'open' | 'closed' | 'reconciling' | 'complete';
  deadline: number | null;
  inviteCode: string;
  createdBy: string;
  createdAt: number;
  discountPercentage: number | null;
  adminFeePercentage: number | null;
}

/**
 * Default admin-fee percentage retained by the Ltd when the order has no
 * explicit adminFeePercentage set.
 */
export const DEFAULT_ADMIN_FEE_PERCENTAGE = 2;

export interface OrderDiscountSummary {
  discountPercentage: number;
  adminFeePercentage: number;
  memberDiscountPercentage: number;
  subtotalBeforeDiscount: number;
  discountAmount: number;
  adminFeeAmount: number;
  memberDiscountAmount: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productCode: string;
  description: string;
  brand: string | null;
  organic: boolean;
  casePrice: number;
  vatRate: number;
  vatPerCase: number;
  unitsPerCase: number | null;
  packSize: number;
  unit: string;
  rrp: number | null;
  barcode: string | null;
  addedBy: string;
  addedAt: number;
  notes: string | null;
}

export interface Claim {
  id: string;
  orderItemId: string;
  memberId: string;
  amount: number;
  flexibility: '+' | '-' | '+-' | '*' | null;
  createdAt: number;
  updatedAt: number;
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
  initials: string | null;
  createdAt: number;
}

export type RoundingStatus = 'ready' | 'nearly' | 'needs_more' | 'over';

export interface RoundingResult {
  totalClaimed: number;
  caseSize: number;
  casesNeeded: number;
  gap: number;
  status: RoundingStatus;
}

export interface DeliveryItem {
  orderItemId: string;
  status: 'arrived' | 'missing' | 'partial' | 'different_price';
  actualPrice: number | null;
  actualQuantity: number | null;
  notes: string | null;
}

export interface Allocation {
  id: string;
  orderItemId: string;
  memberId: string;
  amount: number;
  price: number;
  confirmed: boolean;
}

export interface OrderMember {
  memberId: string;
  name: string | null;
  initials: string | null;
  role: 'organiser' | 'member';
  joinedAt: number;
}

export interface OrderWithMemberCount extends Order {
  memberCount: number;
}

export interface OrderDetail extends Order {
  members: OrderMember[];
}

export interface OrderPreview {
  id: string;
  name: string;
  status: Order['status'];
  memberCount: number;
}

export interface ClaimWithMember extends Claim {
  memberName: string | null;
  memberInitials: string | null;
}

export interface EnrichedOrderItem {
  orderItem: OrderItem;
  catalogueItem: CatalogueItem;
  claims: ClaimWithMember[];
  rounding: RoundingResult;
}

export interface MyClaim {
  claim: Claim;
  orderItem: OrderItem;
  catalogueItem: CatalogueItem;
  estimatedCost: { net: number; vat: number; gross: number };
}

// ── Reconciliation types ─────────────────────────────────────────────────────

export type DeliveryStatus = 'arrived' | 'missing' | 'partial' | 'different_price';

export interface AllocationWithMember extends Allocation {
  memberName: string | null;
  memberInitials: string | null;
}

export interface ReconciliationItem {
  orderItem: OrderItem;
  catalogueItem: CatalogueItem;
  claims: ClaimWithMember[];
  rounding: RoundingResult;
  delivery: DeliveryItem | null;
  allocations: AllocationWithMember[];
}

export interface MemberCostSummary {
  memberId: string;
  memberName: string | null;
  memberInitials: string | null;
  items: {
    orderItemId: string;
    description: string;
    claimed: number;
    allocated: number;
    net: number;
    vat: number;
    gross: number;
    confirmed: boolean;
  }[];
  totals: { net: number; vat: number; gross: number };
  allConfirmed: boolean;
}

export interface ReconciliationSummary {
  items: ReconciliationItem[];
  memberSummaries: MemberCostSummary[];
  orderTotals: { net: number; vat: number; gross: number };
  allConfirmed: boolean;
  discount: OrderDiscountSummary | null;
}
