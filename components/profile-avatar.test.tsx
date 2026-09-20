import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ProfileAvatar from './profile-avatar'

afterEach(cleanup)

it('tries each provider when images fail, then shows personalized initials', () => {
  render(<ProfileAvatar name="Test Person" src="https://example.com/linkedin.jpg" alternatives={['https://example.com/x.jpg', 'https://example.com/instagram.jpg']} />)
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/linkedin.jpg')
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/x.jpg')
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/instagram.jpg')
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('img', { name: 'Test Person, default profile photo' })).toBeInTheDocument()
  expect(screen.getByText('TP')).toBeInTheDocument()
})

it('shows personalized initials when no social photo is available', () => {
  render(<ProfileAvatar name="Test Person" />)
  expect(screen.getByRole('img', { name: 'Test Person, default profile photo' })).toBeInTheDocument()
  expect(screen.getByText('TP')).toBeInTheDocument()
})
