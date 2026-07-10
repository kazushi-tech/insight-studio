export const demoPreviewUrl = '/lp#product-preview'

export const salesContactUrl = (
  import.meta.env.VITE_SALES_CONTACT_URL || 'https://www.petabit.co.jp/contact/'
).trim()

export const companyPrivacyUrl = 'https://www.petabit.co.jp/privacy/'
export const companyProfileUrl = 'https://www.petabit.co.jp/about/'

export function isExternalSalesUrl(url) {
  return /^https?:\/\//i.test(url || '')
}
