namespace Ledger.Desktop
{
    partial class Localized
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.components = new System.ComponentModel.Container();
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(Localized));
            this.lblName = new System.Windows.Forms.Label();
            this.txtName = new System.Windows.Forms.TextBox();
            this.lblRegion = new System.Windows.Forms.Label();
            this.cboRegion = new System.Windows.Forms.ComboBox();
            this.chkNotify = new System.Windows.Forms.CheckBox();
            this.lblHint = new System.Windows.Forms.Label();
            this.lblStatic = new System.Windows.Forms.Label();
            this.pbLogo = new System.Windows.Forms.PictureBox();
            this.imageList1 = new System.Windows.Forms.ImageList(this.components);
            this.btnSave = new System.Windows.Forms.Button();
            this.btnCancel = new System.Windows.Forms.Button();
            ((System.ComponentModel.ISupportInitialize)(this.pbLogo)).BeginInit();
            this.SuspendLayout();
            //
            // lblName
            //
            resources.ApplyResources(this.lblName, "lblName");
            this.lblName.Name = "lblName";
            //
            // txtName
            //
            resources.ApplyResources(this.txtName, "txtName");
            this.txtName.Name = "txtName";
            //
            // lblRegion
            //
            resources.ApplyResources(this.lblRegion, "lblRegion");
            this.lblRegion.Name = "lblRegion";
            //
            // cboRegion
            //
            this.cboRegion.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.cboRegion.FormattingEnabled = true;
            this.cboRegion.Items.AddRange(new object[] {
            resources.GetString("cboRegion.Items"),
            resources.GetString("cboRegion.Items1"),
            resources.GetString("cboRegion.Items2")});
            resources.ApplyResources(this.cboRegion, "cboRegion");
            this.cboRegion.Name = "cboRegion";
            //
            // chkNotify
            //
            resources.ApplyResources(this.chkNotify, "chkNotify");
            this.chkNotify.Location = new System.Drawing.Point(12, 70);
            this.chkNotify.Name = "chkNotify";
            this.chkNotify.UseVisualStyleBackColor = true;
            //
            // lblHint
            //
            resources.ApplyResources(this.lblHint, "lblHint");
            this.lblHint.Name = "lblHint";
            //
            // lblStatic
            //
            this.lblStatic.Location = new System.Drawing.Point(12, 115);
            this.lblStatic.Name = "lblStatic";
            this.lblStatic.Text = "Static";
            //
            // pbLogo
            //
            resources.ApplyResources(this.pbLogo, "pbLogo");
            this.pbLogo.Name = "pbLogo";
            this.pbLogo.TabStop = false;
            //
            // imageList1
            //
            this.imageList1.ImageStream = ((System.Windows.Forms.ImageListStreamer)(resources.GetObject("imageList1.ImageStream")));
            this.imageList1.TransparentColor = System.Drawing.Color.Transparent;
            //
            // btnSave
            //
            resources.ApplyResources(this.btnSave, "btnSave");
            this.btnSave.Name = "btnSave";
            this.btnSave.UseVisualStyleBackColor = true;
            this.btnSave.Click += new System.EventHandler(this.btnSave_Click);
            //
            // btnCancel
            //
            resources.ApplyResources(this.btnCancel, "btnCancel");
            this.btnCancel.DialogResult = System.Windows.Forms.DialogResult.Cancel;
            this.btnCancel.Name = "btnCancel";
            this.btnCancel.UseVisualStyleBackColor = true;
            //
            // Localized
            //
            this.AcceptButton = this.btnSave;
            resources.ApplyResources(this, "$this");
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.CancelButton = this.btnCancel;
            this.Controls.Add(this.btnCancel);
            this.Controls.Add(this.btnSave);
            this.Controls.Add(this.pbLogo);
            this.Controls.Add(this.lblStatic);
            this.Controls.Add(this.lblHint);
            this.Controls.Add(this.chkNotify);
            this.Controls.Add(this.cboRegion);
            this.Controls.Add(this.lblRegion);
            this.Controls.Add(this.txtName);
            this.Controls.Add(this.lblName);
            this.Name = "Localized";
            ((System.ComponentModel.ISupportInitialize)(this.pbLogo)).EndInit();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.Label lblName;
        private System.Windows.Forms.TextBox txtName;
        private System.Windows.Forms.Label lblRegion;
        private System.Windows.Forms.ComboBox cboRegion;
        private System.Windows.Forms.CheckBox chkNotify;
        private System.Windows.Forms.Label lblHint;
        private System.Windows.Forms.Label lblStatic;
        private System.Windows.Forms.PictureBox pbLogo;
        private System.Windows.Forms.ImageList imageList1;
        private System.Windows.Forms.Button btnSave;
        private System.Windows.Forms.Button btnCancel;
    }
}
