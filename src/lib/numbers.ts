export type NumberOffer = {
  id: string;
  city: string;
  label: string;
  prefix: string;
  available: number;
  monthlyPrice: number;
};

export type NumberOrder = {
  id: string;
  city: string;
  customer: string;
  email: string;
  quantity: number;
  monthlyTotal: number;
  status: "requested" | "fulfilled";
  createdAt: string;
};

export type NumberStoreSettings = {
  maintenance: boolean;
  domain: string;
};

export type PublicNumberStore = {
  offers: NumberOffer[];
  maintenance: boolean;
  domain: string;
};

export type AdminUserItem = {
  id: string;
  email: string;
  name: string;
  phone: string;
  walletBalance: number;
  apiBalance: number;
  apiKey?: string | undefined;
  banned: boolean;
  banReason?: string | undefined;
  unlimited?: boolean | undefined;
  createdAt: string;
  updatedAt: string;
  hasPassword?: boolean | undefined;
};

export type AdminNumberStore = {
  offers: NumberOffer[];
  settings: NumberStoreSettings;
  paymentSettings: {
    enabled: boolean;
    environmentDisabled: boolean;
    merchantId: string;
    upiId: string;
    merchantName: string;
    hasAccessToken: boolean;
    hasSessionCookie: boolean;
  };
  orders: NumberOrder[];
  payments: {
    id: string;
    utr: string;
    phone: string;
    userId: string;
    amount: number;
    status: "verified" | "fulfilled" | "refund_required" | "refunded";
    createdAt: string | Date;
  }[];
  users: AdminUserItem[];
  totals: {
    grossMonthly: number;
    fulfilledOrders: number;
    pendingOrders: number;
    stock: number;
    totalUsers: number;
    bannedUsers: number;
    totalUserBalance: number;
  };
};

export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
