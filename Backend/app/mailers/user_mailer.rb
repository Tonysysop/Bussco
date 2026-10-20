class UserMailer < ApplicationMailer
  # Runs inside the delivery job. The code is generated here, so the job's arguments hold only
  # the user and generation. A superseded generation issues nothing and sends nothing.
  def email_verification
    @user = params[:user]
    @code = @user.issue_email_verification_code(params[:generation])
    mail(to: @user.email, subject: "Your BUSSCO verification code") if @code
  end
end
