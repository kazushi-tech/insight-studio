import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  let users
  try {
    users = JSON.parse(process.env.AUTH_USERS || '[]')
  } catch {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const inputHash = createHash('sha256').update(password).digest('hex')
  const matched = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password_hash === inputHash,
  )

  if (!matched) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const token = jwt.sign(
    { user_id: matched.user_id, email: matched.email, role: matched.role },
    jwtSecret,
    { expiresIn: '7d' },
  )

  return res.status(200).json({
    token,
    user: {
      user_id: matched.user_id,
      email: matched.email,
      role: matched.role,
      display_name: matched.display_name,
    },
  })
}
