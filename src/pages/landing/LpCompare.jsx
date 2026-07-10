import LpFeaturePage from './components/LpFeaturePage'

export default function LpCompare() {
  return (
    <LpFeaturePage
      eyebrow="競合LP比較"
      icon="compare_arrows"
      title="LPの違いを、"
      highlight="根拠つきで整理。"
      description="自社と競合の公開LPを並べ、訴求、CTA、信頼要素、情報の順番を比較します。低評価と情報不足を分けて確認できます。"
      image="/imagegen/beginner-analytics-collaboration.webp"
      imageAlt="2人でWebページの違いを確認する様子"
      primaryLabel="比較画面を開く"
      primaryTo="/compare"
      cards={[
        { icon: 'view_quilt', title: '構成を比較', body: 'ファーストビュー、主要セクション、CTAの位置と順番を並べて確認します。' },
        { icon: 'campaign', title: '訴求を比較', body: '誰に何を約束しているか、根拠や不安解消があるかを整理します。' },
        { icon: 'fact_check', title: '保留点を分離', body: '取得できない情報や確認が必要な項目を、悪い評価として扱いません。' },
      ]}
      steps={[
        { title: 'URLを入力', body: '比較する自社LPと競合LPの公開URLを指定します。' },
        { title: 'AIキーを選択', body: 'Geminiを推奨し、必要に応じてClaudeを予備として利用します。' },
        { title: '根拠と施策を確認', body: '確認できた差分と、次に試す改善仮説を分けて読みます。' },
      ]}
      noteTitle="公開ページを分析します"
      note="ログインが必要なページや取得を禁止しているページは対象外です。結果は公開情報をもとにした比較であり、成果を保証するものではありません。"
    />
  )
}
