<Global.Microsoft.VisualBasic.CompilerServices.DesignerGenerated()> _
Partial Class OrdersForm
    Inherits System.Windows.Forms.Form

    'Form overrides dispose to clean up the component list.
    <System.Diagnostics.DebuggerNonUserCode()> _
    Protected Overrides Sub Dispose(ByVal disposing As Boolean)
        Try
            If disposing AndAlso components IsNot Nothing Then
                components.Dispose()
            End If
        Finally
            MyBase.Dispose(disposing)
        End Try
    End Sub

    'Required by the Windows Form Designer
    Private components As System.ComponentModel.IContainer

    'NOTE: The following procedure is required by the Windows Form Designer
    'It can be modified using the Windows Form Designer.  
    'Do not modify it using the code editor.
    <System.Diagnostics.DebuggerStepThrough()> _
    Private Sub InitializeComponent()
        Dim resources As System.ComponentModel.ComponentResourceManager = New System.ComponentModel.ComponentResourceManager(GetType(OrdersForm))
        Me.TabControl1 = New System.Windows.Forms.TabControl()
        Me.TabPage1 = New System.Windows.Forms.TabPage()
        Me.DataGridView1 = New System.Windows.Forms.DataGridView()
        Me.colOrder = New System.Windows.Forms.DataGridViewTextBoxColumn()
        Me.colTotal = New System.Windows.Forms.DataGridViewTextBoxColumn()
        Me.TabPage2 = New System.Windows.Forms.TabPage()
        Me.lblShipped = New System.Windows.Forms.Label()
        Me.dtpShipped = New System.Windows.Forms.DateTimePicker()
        Me.lblDiscount = New System.Windows.Forms.Label()
        Me.trkDiscount = New System.Windows.Forms.TrackBar()
        Me.pnlPriority = New System.Windows.Forms.Panel()
        Me.rbRush = New System.Windows.Forms.RadioButton()
        Me.rbNormal = New System.Windows.Forms.RadioButton()
        Me.lstCarriers = New System.Windows.Forms.ListBox()
        Me.cboWarehouse = New System.Windows.Forms.ComboBox()
        Me.pbLogo = New System.Windows.Forms.PictureBox()
        Me.prgSync = New System.Windows.Forms.ProgressBar()
        Me.lnkTerms = New System.Windows.Forms.LinkLabel()
        Me.Chart1 = New Telerik.WinControls.UI.RadChartView()
        Me.btnRefresh = New System.Windows.Forms.Button()
        Me.lblNote = New System.Windows.Forms.Label()
        Me.TabControl1.SuspendLayout()
        Me.TabPage1.SuspendLayout()
        Me.TabPage2.SuspendLayout()
        Me.pnlPriority.SuspendLayout()
        CType(Me.DataGridView1, System.ComponentModel.ISupportInitialize).BeginInit()
        CType(Me.trkDiscount, System.ComponentModel.ISupportInitialize).BeginInit()
        Me.SuspendLayout()
        '
        'TabControl1
        '
        Me.TabControl1.Controls.Add(Me.TabPage1)
        Me.TabControl1.Controls.Add(Me.TabPage2)
        Me.TabControl1.Dock = System.Windows.Forms.DockStyle.Top
        Me.TabControl1.Location = New System.Drawing.Point(0, 0)
        Me.TabControl1.Name = "TabControl1"
        Me.TabControl1.SelectedIndex = 0
        Me.TabControl1.Size = New System.Drawing.Size(520, 260)
        Me.TabControl1.TabIndex = 0
        '
        'TabPage1
        '
        Me.TabPage1.Controls.Add(Me.DataGridView1)
        Me.TabPage1.Location = New System.Drawing.Point(4, 22)
        Me.TabPage1.Name = "TabPage1"
        Me.TabPage1.Size = New System.Drawing.Size(512, 234)
        Me.TabPage1.TabIndex = 0
        Me.TabPage1.Text = "Orders"
        '
        'DataGridView1
        '
        Me.DataGridView1.Columns.AddRange(New System.Windows.Forms.DataGridViewColumn() {Me.colOrder, Me.colTotal})
        Me.DataGridView1.Dock = System.Windows.Forms.DockStyle.Fill
        Me.DataGridView1.Location = New System.Drawing.Point(0, 0)
        Me.DataGridView1.Name = "DataGridView1"
        Me.DataGridView1.Size = New System.Drawing.Size(512, 234)
        Me.DataGridView1.TabIndex = 0
        '
        'colOrder
        '
        Me.colOrder.HeaderText = "Order #"
        Me.colOrder.Name = "colOrder"
        '
        'colTotal
        '
        Me.colTotal.HeaderText = "Total"
        Me.colTotal.Name = "colTotal"
        '
        'TabPage2
        '
        Me.TabPage2.Controls.Add(Me.lblShipped)
        Me.TabPage2.Controls.Add(Me.dtpShipped)
        Me.TabPage2.Controls.Add(Me.lblDiscount)
        Me.TabPage2.Controls.Add(Me.trkDiscount)
        Me.TabPage2.Controls.Add(Me.pnlPriority)
        Me.TabPage2.Controls.Add(Me.lstCarriers)
        Me.TabPage2.Controls.Add(Me.cboWarehouse)
        Me.TabPage2.Location = New System.Drawing.Point(4, 22)
        Me.TabPage2.Name = "TabPage2"
        Me.TabPage2.Size = New System.Drawing.Size(512, 234)
        Me.TabPage2.TabIndex = 1
        Me.TabPage2.Text = "Shipping"
        '
        'lblShipped
        '
        Me.lblShipped.AutoSize = True
        Me.lblShipped.Location = New System.Drawing.Point(8, 12)
        Me.lblShipped.Name = "lblShipped"
        Me.lblShipped.Text = "Ship at"
        '
        'dtpShipped
        '
        Me.dtpShipped.Format = System.Windows.Forms.DateTimePickerFormat.Time
        Me.dtpShipped.Location = New System.Drawing.Point(90, 9)
        Me.dtpShipped.Name = "dtpShipped"
        Me.dtpShipped.ShowUpDown = True
        Me.dtpShipped.Size = New System.Drawing.Size(120, 20)
        Me.dtpShipped.TabIndex = 1
        '
        'lblDiscount
        '
        Me.lblDiscount.AutoSize = True
        Me.lblDiscount.Location = New System.Drawing.Point(8, 44)
        Me.lblDiscount.Name = "lblDiscount"
        Me.lblDiscount.Text = "Discount"
        '
        'trkDiscount
        '
        Me.trkDiscount.Location = New System.Drawing.Point(8, 60)
        Me.trkDiscount.Maximum = 50
        Me.trkDiscount.Name = "trkDiscount"
        Me.trkDiscount.Size = New System.Drawing.Size(200, 45)
        Me.trkDiscount.TabIndex = 2
        '
        'pnlPriority
        '
        Me.pnlPriority.Controls.Add(Me.rbRush)
        Me.pnlPriority.Controls.Add(Me.rbNormal)
        Me.pnlPriority.Location = New System.Drawing.Point(8, 110)
        Me.pnlPriority.Name = "pnlPriority"
        Me.pnlPriority.Size = New System.Drawing.Size(200, 30)
        Me.pnlPriority.TabIndex = 3
        '
        'rbRush
        '
        Me.rbRush.AutoSize = True
        Me.rbRush.Location = New System.Drawing.Point(100, 6)
        Me.rbRush.Name = "rbRush"
        Me.rbRush.Text = "Rush"
        '
        'rbNormal
        '
        Me.rbNormal.AutoSize = True
        Me.rbNormal.Checked = True
        Me.rbNormal.Location = New System.Drawing.Point(4, 6)
        Me.rbNormal.Name = "rbNormal"
        Me.rbNormal.TabStop = True
        Me.rbNormal.Text = "Normal"
        '
        'lstCarriers
        '
        Me.lstCarriers.FormattingEnabled = True
        Me.lstCarriers.Items.AddRange(New Object() {"Post", "Courier", "Say ""hi"" freight"})
        Me.lstCarriers.Location = New System.Drawing.Point(8, 150)
        Me.lstCarriers.Name = "lstCarriers"
        Me.lstCarriers.SelectionMode = System.Windows.Forms.SelectionMode.MultiExtended
        Me.lstCarriers.Size = New System.Drawing.Size(200, 69)
        Me.lstCarriers.TabIndex = 4
        '
        'cboWarehouse
        '
        Me.cboWarehouse.FormattingEnabled = True
        Me.cboWarehouse.Location = New System.Drawing.Point(230, 150)
        Me.cboWarehouse.Name = "cboWarehouse"
        Me.cboWarehouse.Size = New System.Drawing.Size(200, 21)
        Me.cboWarehouse.TabIndex = 5
        '
        'pbLogo
        '
        Me.pbLogo.Image = CType(resources.GetObject("pbLogo.Image"), System.Drawing.Image)
        Me.pbLogo.Location = New System.Drawing.Point(12, 270)
        Me.pbLogo.Name = "pbLogo"
        Me.pbLogo.Size = New System.Drawing.Size(48, 48)
        Me.pbLogo.TabStop = False
        '
        'prgSync
        '
        Me.prgSync.Location = New System.Drawing.Point(70, 280)
        Me.prgSync.Maximum = 200
        Me.prgSync.Name = "prgSync"
        Me.prgSync.Size = New System.Drawing.Size(200, 23)
        '
        'lnkTerms
        '
        resources.ApplyResources(Me.lnkTerms, "lnkTerms")
        Me.lnkTerms.Location = New System.Drawing.Point(280, 284)
        Me.lnkTerms.Name = "lnkTerms"
        Me.lnkTerms.TabStop = True
        '
        'Chart1
        '
        Me.Chart1.Location = New System.Drawing.Point(12, 330)
        Me.Chart1.Name = "Chart1"
        Me.Chart1.Size = New System.Drawing.Size(496, 120)
        '
        'btnRefresh
        '
        Me.btnRefresh.Anchor = CType((System.Windows.Forms.AnchorStyles.Bottom Or System.Windows.Forms.AnchorStyles.Right), System.Windows.Forms.AnchorStyles)
        Me.btnRefresh.Location = New System.Drawing.Point(433, 460)
        Me.btnRefresh.Name = "btnRefresh"
        Me.btnRefresh.Size = New System.Drawing.Size(75, 23)
        Me.btnRefresh.TabIndex = 6
        Me.btnRefresh.Text = "&Refresh"
        '
        'lblNote
        '
        Me.lblNote.AutoSize = True
        Me.lblNote.Location = New System.Drawing.Point(12, 465)
        Me.lblNote.Name = "lblNote"
        Me.lblNote.Text = "Totals include ""VAT"""
        '
        'OrdersForm
        '
        Me.AutoScaleDimensions = New System.Drawing.SizeF(6.0!, 13.0!)
        Me.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font
        Me.ClientSize = New System.Drawing.Size(520, 495)
        Me.Controls.AddRange(New System.Windows.Forms.Control() {Me.lblNote, Me.btnRefresh, Me.Chart1, Me.lnkTerms, Me.prgSync, Me.pbLogo, Me.TabControl1})
        Me.Name = "OrdersForm"
        Me.Text = "Orders"
        Me.TabControl1.ResumeLayout(False)
        Me.TabPage1.ResumeLayout(False)
        Me.TabPage2.ResumeLayout(False)
        Me.pnlPriority.ResumeLayout(False)
        CType(Me.DataGridView1, System.ComponentModel.ISupportInitialize).EndInit()
        CType(Me.trkDiscount, System.ComponentModel.ISupportInitialize).EndInit()
        Me.ResumeLayout(False)

    End Sub

    Friend WithEvents TabControl1 As System.Windows.Forms.TabControl
    Friend WithEvents TabPage1 As System.Windows.Forms.TabPage
    Friend WithEvents DataGridView1 As System.Windows.Forms.DataGridView
    Friend WithEvents colOrder As System.Windows.Forms.DataGridViewTextBoxColumn
    Friend WithEvents colTotal As System.Windows.Forms.DataGridViewTextBoxColumn
    Friend WithEvents TabPage2 As System.Windows.Forms.TabPage
    Friend WithEvents lblShipped As System.Windows.Forms.Label
    Friend WithEvents dtpShipped As System.Windows.Forms.DateTimePicker
    Friend WithEvents lblDiscount As System.Windows.Forms.Label
    Friend WithEvents trkDiscount As System.Windows.Forms.TrackBar
    Friend WithEvents pnlPriority As System.Windows.Forms.Panel
    Friend WithEvents rbRush As System.Windows.Forms.RadioButton
    Friend WithEvents rbNormal As System.Windows.Forms.RadioButton
    Friend WithEvents lstCarriers As System.Windows.Forms.ListBox
    Friend WithEvents cboWarehouse As System.Windows.Forms.ComboBox
    Friend WithEvents pbLogo As System.Windows.Forms.PictureBox
    Friend WithEvents prgSync As System.Windows.Forms.ProgressBar
    Friend WithEvents lnkTerms As System.Windows.Forms.LinkLabel
    Friend WithEvents Chart1 As Telerik.WinControls.UI.RadChartView
    Friend WithEvents btnRefresh As System.Windows.Forms.Button
    Friend WithEvents lblNote As System.Windows.Forms.Label
End Class
