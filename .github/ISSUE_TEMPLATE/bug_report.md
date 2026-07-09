name: Bug Report
description: Report a bug in Perdura
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug!

  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: Also tell us, what did you expect to happen?
      placeholder: "Describe the bug..."
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: Perdura Version
      description: Which version are you running?
      placeholder: "e.g. 0.3.2"
    validations:
      required: true

  - type: dropdown
    id: os
    attributes:
      label: Operating System
      options:
        - Windows
        - macOS
        - Linux
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Minimal steps to reproduce the issue.
      placeholder: |
        1. Go to ...
        2. Click on ...
        3. See error
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Relevant Log Output
      description: Paste any error logs or traceback output.
      render: shell
