using System;
using System.Windows.Forms;

namespace Ledger
{
    public partial class LoginForm : Form
    {
        public LoginForm()
        {
            InitializeComponent();
        }

        private void btnOK_Click(object sender, EventArgs e)
        {
            // The handler's code is what the port must reimplement; the reader never reads it.
            if (txtUser.Text.Length == 0) { MessageBox.Show("Enter a user name."); return; }
            DialogResult = DialogResult.OK;
        }

        private void txtUser_TextChanged(object sender, EventArgs e) { btnOK.Enabled = txtUser.Text.Length > 0; }
        private void chkRemember_CheckedChanged(object sender, EventArgs e) { }
        private void cboRegion_SelectedIndexChanged(object sender, EventArgs e) { }
        private void LoginForm_Load(object sender, EventArgs e) { }
        private void LoginForm_FormClosing(object sender, FormClosingEventArgs e) { }
        private void timer1_Tick(object sender, EventArgs e) { }
        private void openToolStripMenuItem_Click(object sender, EventArgs e) { }
        private void exitToolStripMenuItem_Click(object sender, EventArgs e) { Close(); }
        private void aboutToolStripMenuItem_Click(object sender, EventArgs e) { }
    }
}
