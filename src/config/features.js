// 顧客・プロジェクト管理APIは未提供のため、販売画面では既定で閉じる。
// 作成・更新・招待・削除のAPI契約とE2Eが揃った環境だけで有効化する。
export const isProjectManagementEnabled =
  import.meta.env.VITE_ENABLE_PROJECT_MANAGEMENT === 'true'
