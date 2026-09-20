import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import MessagingConnections from './messaging-connections'

afterEach(cleanup)

it('only shows messaging services that have MongoDB records', () => {
  const { rerender } = render(<MessagingConnections discord={false} whatsapp />)
  expect(screen.getByText('WhatsApp')).toBeInTheDocument()
  expect(screen.queryByText('Discord')).not.toBeInTheDocument()
  rerender(<MessagingConnections discord whatsapp={false} />)
  expect(screen.getByText('Discord')).toBeInTheDocument()
  expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
})

it('renders nothing when neither service has a record', () => {
  const { container } = render(<MessagingConnections discord={false} whatsapp={false} />)
  expect(container).toBeEmptyDOMElement()
})
