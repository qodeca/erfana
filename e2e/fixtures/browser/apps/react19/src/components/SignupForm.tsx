// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState, type FormEvent } from 'react'

export function SignupForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [plan, setPlan] = useState('basic')
  const [submitted, setSubmitted] = useState<string | null>(null)

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(name.trim() === '' ? 'Enter your name' : `Thanks, ${name} (${plan})`)
  }

  return (
    <form className="signup-form" onSubmit={onSubmit}>
      <h2>Sign up</h2>
      <label className="signup-field">
        Name
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="signup-field">
        Email
        <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="signup-field">
        Plan
        <select name="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="basic">Basic</option>
          <option value="team">Team</option>
        </select>
      </label>
      <button className="signup-submit" type="submit">
        Create account
      </button>
      {submitted && (
        <p className="signup-result" role="status">
          {submitted}
        </p>
      )}
    </form>
  )
}
