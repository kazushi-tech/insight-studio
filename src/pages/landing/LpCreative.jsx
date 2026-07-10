import LpFeaturePage from './components/LpFeaturePage'

export default function LpCreative() {
  return (
    <LpFeaturePage
      eyebrow="広告画像の確認"
      icon="rate_review"
      title="広告画像を、"
      highlight="次のテスト案へ。"
      description="バナーやサムネイルの訴求、視線誘導、CTA、信頼要素を確認し、LPとの一致と次に試す仮説を整理します。"
      image="/imagegen/data-to-action-paper-collage.webp"
      imageAlt="データから次の行動へ進む紙コラージュ"
      primaryLabel="診断画面を開く"
      primaryTo="/creative-review"
      cards={[
        { icon: 'visibility', title: '視線誘導', body: '最初に目に入る要素と、商品・訴求・CTAへ進む順番を確認します。' },
        { icon: 'ads_click', title: '訴求とCTA', body: '誰向けの何の提案か、クリック後の行動が伝わるかを整理します。' },
        { icon: 'science', title: 'テスト案', body: '断定ではなく、1回に1要素を変えて検証できる改善仮説として提示します。' },
      ]}
      steps={[
        { title: '画像を選択', body: 'PNG、JPG、WebPの広告画像をアップロードします。' },
        { title: '補助情報を追加', body: 'ブランド情報やLP URLがある場合は、評価の前提として追加します。' },
        { title: '確認して試す', body: '指摘の根拠を確認し、優先度の高い仮説からテストします。' },
      ]}
      noteTitle="画像分析にはAIキーが必要です"
      note="GeminiまたはClaudeのAPIキーを設定して利用します。スコアは絶対評価ではなく、制作レビューとA/Bテスト設計を補助するための指標です。"
    />
  )
}
