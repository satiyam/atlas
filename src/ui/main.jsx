import React from 'react'
import { createRoot } from 'react-dom/client'
import AtlasInterface from './atlas_interface.jsx'

const container = document.getElementById('root')
const root = createRoot(container)
root.render(<AtlasInterface />)
